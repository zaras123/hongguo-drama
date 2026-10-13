import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import { gzipSync } from "node:zlib"
import { pathToFileURL } from "node:url"
import { shareUrl, isPublicAddress, openResponse, followResponse } from "../components/Http.js"
import HongguoAPI from "../components/HongguoAPI.js"
import { isManjuLink } from "../components/ManjuAPI.js"

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "hg-regressions-"))
const plugin = path.join(sandbox, "plugins/hongguo-drama")
await fs.cp(new URL("../", import.meta.url), plugin, { recursive: true })
await fs.mkdir(path.join(sandbox, "lib/plugins"), { recursive: true })
await fs.copyFile(new URL("plugin-stub.js", import.meta.url), path.join(sandbox, "lib/plugins/plugin.js"))
globalThis.logger = { info() {}, warn() {}, error() {}, mark() {} }
globalThis.segment = { video: (file) => ({ type: "video", file }), image: (file) => ({ type: "image", file }) }
const { HongguoDrama } = await import(pathToFileURL(path.join(plugin, "index.js")))
const mp4 = await fs.readFile(new URL("fixtures/video.mp4", import.meta.url))
const sid = "7664958856774044697"
const vids = ["7664960983332310041", "7664961183094410265"]
let internalHits = 0
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")
  const mode = url.searchParams.get("mode")
  if (url.pathname === "/internal") { internalHits++; return res.end("private") }
  if (url.pathname === "/slow") {
    res.writeHead(200); res.flushHeaders()
    return setTimeout(() => res.end("too late"), 250)
  }
  if (url.pathname === "/large") return res.end("x".repeat(8192))
  if (url.pathname === "/gzip") {
    res.writeHead(200, { "content-encoding": "gzip" })
    return res.end(gzipSync("x".repeat(8192)))
  }
  if (url.pathname === "/redirect") {
    res.writeHead(302, { location: "http://127.0.0.2/internal" }); return res.end()
  }
  if (url.pathname === "/stream") {
    if (mode === "slow") {
      res.writeHead(200); res.flushHeaders()
      return setTimeout(() => res.end(mp4), 200)
    }
    if (mode === "redirect") { res.writeHead(302, { location: "/internal" }); return res.end() }
    if (mode === "text") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("upstream failed") }
    if (mode === "fake") { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end("not a video") }
    if (mode === "partial") {
      res.writeHead(206, { "content-range": "bytes 0-31/1000000", "content-length": "32", "content-type": "video/mp4" })
      return res.end(mp4.subarray(0, 32))
    }
    if (mode === "broken") {
      res.writeHead(200, { "content-type": "video/mp4", "content-length": mp4.length + 200 })
      res.write(mp4)
      return setTimeout(() => res.destroy(), 20)
    }
    res.writeHead(200, { "content-type": "video/mp4", "content-length": mp4.length })
    return res.end(mp4)
  }
  res.writeHead(404); res.end()
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const base = "http://127.0.0.1:" + server.address().port
const api = new HongguoAPI({ apiServer: base, siteOrigin: base, tempDir: path.join(sandbox, "downloads"),
  ffprobePath: process.env.HG_FFPROBE || "ffprobe", downloadRetries: 0 })
test.after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fs.rm(sandbox, { recursive: true, force: true })
})

test("share URLs reject host tricks, credentials, private hosts and unusual ports", async () => {
  for (const url of [base + "/internal#hongguoduanju.com", "https://hongguoduanju.com.evil.test/",
    "https://hongguoduanju.com@127.0.0.1/", "https://hongguoduanju.com:8443/", "file:///tmp/test"]) {
    assert.throws(() => shareUrl(url))
    assert.equal(isManjuLink(url), false)
  }
  assert.equal(shareUrl("https://kylin.hainanyuyue.com/s/abc").hostname, "kylin.hainanyuyue.com")
  const inst = new HongguoDrama()
  await inst.autoParse({ msg: base + "/internal#hongguoduanju.com", user_id: 1, reply: async () => true })
  assert.equal(internalHits, 0)
})

test("builtin API alias resolves to the plugin-managed local service", () => {
  const builtin = new HongguoAPI({ apiServer: "builtin", managedPort: 19999 })
  assert.equal(builtin.server, "http://127.0.0.1:19999")
  assert.equal(builtin.serverEnabled(), true)
  const disabled = new HongguoAPI({ apiServer: "", managedPort: 19999 })
  assert.equal(disabled.server, "")
  assert.equal(disabled.serverEnabled(), false)
})

test("DNS guards block private and mapped addresses before opening a socket", async () => {
  assert.equal(isPublicAddress("2001:4860:4860::8888"), true)
  assert.equal(isPublicAddress("93.184.216.34"), true)
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.64.0.1", "172.16.1.2",
    "192.168.1.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2002:7f00:1::"]) {
    assert.equal(isPublicAddress(address), false, address)
    await assert.rejects(openResponse("https://hongguoduanju.com/", {}, {
      lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
      request: () => assert.fail("must not connect")
    }), /禁止访问/)
  }
})

test("DNS verified address is pinned to socket lookup, with original hostname intact", async () => {
  let resolves = 0
  const result = await openResponse("https://hongguoduanju.com/player", {}, {
    lookup: async () => { resolves++; return [{ address: "93.184.216.34", family: 4 }] },
    request: (url, options, callback) => {
      assert.equal(url.hostname, "hongguoduanju.com")
      options.lookup(url.hostname, { all: true }, (err, records) => {
        assert.equal(err, null); assert.equal(records[0].address, "93.184.216.34")
      })
      return { once() {}, end() { callback({ statusCode: 200, headers: {} }) } }
    }
  })
  assert.equal(result.status, 200)
  assert.equal(resolves, 1)
})

test("redirects cannot enter private hosts or redirect authenticated streams", async () => {
  await assert.rejects(followResponse(base + "/redirect", { trustedOrigin: base }), /禁止访问/)
  await assert.rejects(api.download(base + "/stream?mode=redirect", "redirect"), /不允许重定向/)
  assert.equal(internalHits, 0)
})

test("page body deadline and byte limit apply after headers", async () => {
  await assert.rejects(new HongguoAPI({ siteOrigin: base, requestTimeout: 40 }).getText(base + "/slow"), /超时/)
  await assert.rejects(new HongguoAPI({ siteOrigin: base, maxPageSizeMB: 0.001 }).getText(base + "/large"), /大小限制/)
  await assert.rejects(new HongguoAPI({ siteOrigin: base, maxPageSizeMB: 0.001 }).getText(base + "/gzip"), /大小限制/)
  assert.equal((await api.getText(base + "/gzip")).length, 8192)
})

test("downloads reject text, fake containers, partial ranges and broken transfer", async () => {
  for (const mode of ["text", "fake", "partial", "broken"]) {
    await assert.rejects(api.download(base + "/stream?mode=" + mode, mode))
    assert.deepEqual(await fs.readdir(api.config.tempDir), [])
  }
  const timed = new HongguoAPI({ ...api.config, downloadTimeout: 40 })
  await assert.rejects(timed.download(base + "/stream?mode=slow", "slow"), /超限|abort/i)
  assert.deepEqual(await fs.readdir(api.config.tempDir), [])
  const file = await api.download(base + "/stream", "valid")
  assert.deepEqual(await fs.readFile(file.path), mp4)
  await api.remove(file.path)
})

test("concurrent parses keep their own shared episode", async () => {
  const shared = new HongguoAPI()
  let release, enter
  const entered = new Promise((resolve) => { enter = resolve })
  const pending = new Promise((resolve) => { release = resolve })
  let count = 0
  shared.getSeries = async () => {
    if (++count === 1) { enter(); await pending }
    return { episodes: vids.map((vid) => ({ vid })) }
  }
  const first = shared.getSeriesByInput("https://hongguoduanju.com/player/" + sid + "/" + vids[0])
  await entered
  assert.equal((await shared.getSeriesByInput("https://hongguoduanju.com/player/" + sid + "/" + vids[1])).startIndex, 2)
  release()
  assert.equal((await first).startIndex, 1)
})

test("Chinese and space paths work with native icqq video handling", async () => {
  const inst = new HongguoDrama()
  const file = path.join(sandbox, "测试 第1集.mp4")
  await fs.writeFile(file, mp4)
  await inst.sendVideo({ reply: async ({ file: payload }) => {
    assert.equal(payload, file)
    assert.deepEqual(await fs.readFile(payload.replace(/^file:\/{2}/, "")), mp4)
    return { message_id: 1 }
  } }, file, "测试 第1集")
})

test("native group files, wrapper group files and friend files have separate contracts", async () => {
  const inst = new HongguoDrama()
  inst.config.sendType = "file"
  const file = path.join(sandbox, "upload.mp4")
  await fs.writeFile(file, mp4)
  let sent = 0
  await inst.sendVideo({ group: { fs: { upload: async (input, pid, name) => {
    assert.equal(input, file); assert.equal(pid, "/"); assert.equal(name, "title.mp4"); sent++; return true
  } }, sendFile: () => assert.fail("native group must use fs.upload") } }, file, "title")
  for (const type of ["group", "friend"]) {
    await inst.sendVideo({ [type]: { sendFile: async (input, name) => {
      assert.equal(input, file); assert.equal(name, "title.mp4"); sent++; return true
    } } }, file, "title")
  }
  assert.equal(sent, 3)
  await assert.rejects(inst.sendVideo({}, file, "title"), /不支持文件/)
})

test("shared manju episode is always attempted first regardless of volatile accessible metadata", () => {
  const inst = new HongguoDrama()
  inst.api = api
  const series = { source: "manju", backend: "web", startIndex: 5, accessible: 3,
    episodes: Array.from({ length: 8 }, (_, index) => ({ index: index + 1 })) }
  assert.deepEqual(inst.resolveAutoDownloadIndexes(series).indexes, [5])
  assert.match(inst.resolveAutoDownloadIndexes(series).note, /仍优先尝试分享的第 5 集/)
  assert.deepEqual(inst.resolveAutoDownloadIndexes({ ...series, backend: "server" }).indexes, [5])
  assert.equal(inst.episodePreference(0), "server")
  assert.equal(inst.episodePreference(1), "site")
  for (const config of [{ apiServer: "" }, { apiServer: base, useApiServer: false },
    { apiServer: base, preferApiServer: false }]) {
    const noApi = new HongguoDrama()
    noApi.config = { ...noApi.config, ...config }
    noApi.api = new HongguoAPI(noApi.config)
    assert.deepEqual(noApi.resolveAutoDownloadIndexes(series).indexes, [5])
    assert.equal(noApi.episodePreference(0), "site")
    noApi.config.autoDownloadRange = "5"
    assert.deepEqual(noApi.resolveAutoDownloadIndexes(series).indexes, [5])
  }
})

test("retry probes stale site URLs and advances to the next player candidate", async () => {
  const retryApi = new HongguoAPI({ siteOrigin: "https://hongguoduanju.com" })
  const calls = []
  retryApi.getText = async (url) => {
    calls.push(url)
    return JSON.stringify({
      contentUrl: calls.length === 1
        ? "https://cdn.example.com/stale.mp4"
        : "https://cdn.example.com/good.mp4"
    })
  }
  retryApi.probeMediaUrl = async (url) => url.endsWith("/good.mp4")
  assert.equal(
    await retryApi.siteEpisodeUrl(sid, vids[0], { attempt: 1 }),
    "https://cdn.example.com/good.mp4"
  )
  assert.equal(calls.length, 2)
  assert.ok(calls.every((url) => url.includes("hg_retry=1-")))
})

test("parse concurrency gate is shared and released after failure", async () => {
  const inst = new HongguoDrama()
  const other = new HongguoDrama()
  inst.config.maxConcurrentParses = other.config.maxConcurrentParses = 1
  let release
  const first = inst.withParseSlot(() => new Promise((resolve) => { release = resolve }))
  await assert.rejects(other.withParseSlot(() => true), /任务已满/)
  release(); await first
  await assert.rejects(other.withParseSlot(() => { throw new Error("fixture") }), /fixture/)
  assert.equal(await inst.withParseSlot(() => true), true)
})
