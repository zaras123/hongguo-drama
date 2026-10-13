import test from "node:test"
import assert from "node:assert/strict"
import HongguoAPI from "../components/HongguoAPI.js"
import ManjuAPI, { parseManjuShare } from "../components/ManjuAPI.js"

const sid = "7664958856774044697"
const vids = ["7664960983332310041", "7664961183094410265", "7664960914432478233"]
const html = JSON.stringify({ series_name: "Fixture", vid_list: vids, series_intro: "intro",
  accessible_episode_cnt: 1, contentUrl: "https://cdn.example.com/video.mp4", tags: ["test"] })
const share = "window._ROUTER_DATA=" + JSON.stringify({ loaderData: { "video-animation-share_page": {
  pageData: { chapter_ids: vids, used_chapter_id: vids[1], chapter_order: 2, video_id: sid,
    series_data: { title: "Fixture", serial_count: 3 } }
} } })

test("official metadata, search and current episode retain parser contracts", async () => {
  const api = new HongguoAPI()
  api.getText = async (url) => url.includes("/search/") ? JSON.stringify({ searchList: [
    { video_data: { series_id: sid, series_title: "Fixture", episode_cnt: 3 } }
  ] }) : html
  assert.equal((await api.getSeriesByInput("https://hongguoduanju.com/player/" + sid + "/" + vids[1])).startIndex, 2)
  assert.equal((await api.search("Fixture"))[0].seriesId, sid)
  assert.equal(await api.siteEpisodeUrl(sid, vids[0]), "https://cdn.example.com/video.mp4")
})

test("short links support nested schemes, metadata redirects and bounded loops", async () => {
  const api = new HongguoAPI()
  for (const text of [
    '<meta http-equiv="refresh" content="0; url=https://hongguoduanju.com/player/' + sid + '">',
    'location.replace("dragon8662://detail?params=' + encodeURIComponent(JSON.stringify({ book_id: sid })) + '")'
  ]) {
    api.request = async () => ({ url: "https://applink.novelquickapp.com/a", text: async () => text })
    assert.equal(await api.resolveSeriesId("https://applink.novelquickapp.com/a"), sid)
  }
  let requests = 0
  api.request = async () => { requests++; return { url: "https://applink.novelquickapp.com/a",
    text: async () => 'location.replace("https://applink.novelquickapp.com/a")' } }
  await assert.rejects(api.resolveSeriesId("https://applink.novelquickapp.com/a"), /未能/)
  assert.equal(requests, 1)
})

test("multiple ID candidates and encoded parameters still resolve on official hosts", async () => {
  const api = new HongguoAPI()
  const seen = []
  api.getSeries = async (id) => {
    seen.push(id)
    if (id !== sid) throw new Error("invalid fixture ID")
    return { seriesId: id, episodes: vids.map((vid) => ({ vid })) }
  }
  const result = await api.getSeriesByInput("https://hongguoduanju.com/detail?series_id=111111111111111111&book_id=" + sid)
  assert.equal(result.seriesId, sid)
  assert.equal(seen.length, 2)
  const payload = encodeURIComponent(encodeURIComponent(JSON.stringify({ book_id: sid })))
  assert.equal(await api.resolveSeriesId("https://hongguoduanju.com/detail?payload=" + payload), sid)
})

test("failed API metadata falls back to official site", async () => {
  const api = new HongguoAPI({ apiServer: "http://127.0.0.1:1" })
  api.serverSeries = async () => { throw new Error("offline") }
  api.getText = async () => html
  const series = await api.getSeries(sid)
  assert.equal(series.source, "web")
  assert.equal(series.episodes.length, 3)
})

test("manju web fallback records actual backend and accessible episode count", async () => {
  assert.equal(parseManjuShare(share).order, 2)
  const api = new ManjuAPI({ apiServer: "" })
  api.hongguo.request = async () => ({ url: "https://hainanyuyue.com/share/video-animation-share", text: async () => share })
  api.hongguo.getText = async () => html
  const series = await api.getSeriesByInput("https://kylin.hainanyuyue.com/s/fixture")
  assert.equal(series.backend, "web")
  assert.equal(series.accessible, 1)
  assert.equal(series.startIndex, 2)
})

test("manju API route uses share chapter IDs when upstream metadata is unavailable", async () => {
  const api = new ManjuAPI({ apiServer: "http://127.0.0.1:1" })
  api.hongguo.request = async () => ({ url: "https://hainanyuyue.com/share/video-animation-share", text: async () => share })
  api.hongguo.serverSeries = async () => { throw new Error("episodes unavailable") }
  api.hongguo.getText = async () => assert.fail("official site must not be required when apiServer is configured")
  const series = await api.getSeriesByInput("https://kylin.hainanyuyue.com/s/fixture")
  assert.equal(series.backend, "server")
  assert.equal(series.episodes.length, 3)
  assert.equal(series.startIndex, 2)
  assert.equal(series.episodes[1].vid, vids[1])
})

test("manju API success does not require official site and keeps shared episode", async () => {
  const api = new ManjuAPI({ apiServer: "http://127.0.0.1:1" })
  api.hongguo.request = async () => ({ url: "https://hainanyuyue.com/share/video-animation-share", text: async () => share })
  api.hongguo.serverSeries = async () => ({ title: "Fixture", seriesId: sid, episodes: vids.map((vid) => ({ vid })) })
  api.hongguo.getText = async () => assert.fail("official site should not be requested")
  const series = await api.getSeriesByInput("https://kylin.hainanyuyue.com/s/fixture")
  assert.equal(series.backend, "server")
  assert.equal(series.startIndex, 2)
})
