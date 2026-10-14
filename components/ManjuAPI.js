import HongguoAPI, { cleanUrl, extractJson, toTagList } from "./HongguoAPI.js"
import { shareUrl } from "./Http.js"

/**
 * 红果漫剧（kylin.hainanyuyue.com 分享链接）数据源。
 *
 * 分享页 hainanyuyue.com/share/video-animation-share 是服务端渲染的：
 * window._ROUTER_DATA 里带剧名、封面、简介、题材、全集 chapter_ids 和当前集，
 * 但 play_url 是被服务端截断的 30 秒预览（URL 上带 start=0&end=30，去掉就 403），
 * 正片要走 App 的签名接口，普通请求拿不到。
 *
 * 好消息是分享页 params.video_id 就是同一部剧在红果官网（hongguoduanju.com）的
 * series_id：官网播放页的 vid_list 与分享页 chapter_ids 完全一致，因此分集信息和
 * 前几集直链都能直接复用官网链路，不需要任何签名。
 */

const ROUTER_KEY = "_ROUTER_DATA"
const SHARE_PAGE_KEY = "video-animation-share_page"
const ID_RE = /^\d{6,30}$/
/** 分享页偶发只返回空壳（SSR 兜底成客户端渲染），多试几次 */
const SHARE_TRIES = 3

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** kylin 短链域名（分享链接的入口） */
export const MANJU_HOST_RE = /(?:^|[./@])kylin\.hainanyuyue\.com(?=[:/?#]|$)/i
/** 短链跳转后的漫剧分享页 */
export const MANJU_SHARE_RE = /hainanyuyue\.com\/share\/video-animation-share/i

/** 判断文本里是不是红果漫剧分享链接 */
export function isManjuLink(value) {
  try {
    const url = shareUrl(pickUrl(value))
    return url.hostname === "kylin.hainanyuyue.com" ||
      (["hainanyuyue.com", "www.hainanyuyue.com"].includes(url.hostname) &&
        url.pathname.startsWith("/share/video-animation-share"))
  } catch { return false }
}

/** 从 text 里取出第一个 http(s) 链接 */
function pickUrl(text) {
  const match = String(text ?? "").match(/https?:\/\/[^\s"'<>（）()【】,，。；;]+/)
  return match ? match[0].replace(/[。；;，,)\]）】]+$/, "") : ""
}

function normalizeTitle(value) {
  return String(value ?? "")
    .replace(/[\s!！?？.。·:：,，'"“”‘’\-_—|/]/g, "")
    .toLowerCase()
}

/** 从 start（必须是 { 或 [）开始按括号配平截取完整 JSON 片段 */
function sliceBalanced(text, start) {
  const open = text[start]
  const close = open === "[" ? "]" : "}"
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** 取出页面里的 window._ROUTER_DATA（SSR 数据），失败返回 null */
export function extractRouterData(html) {
  const source = String(html ?? "")
  const keyAt = source.indexOf(ROUTER_KEY)
  if (keyAt < 0) return null

  const start = source.indexOf("{", keyAt + ROUTER_KEY.length)
  if (start < 0) return null

  const raw = sliceBalanced(source, start)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * 解析漫剧分享页 -> 统一剧集结构（不含直链）。
 * 直链由官网链路补上，见 ManjuAPI#getSeriesByInput。
 */
export function parseManjuShare(html, finalUrl = "") {
  const data = extractRouterData(html)
  if (!data) throw new Error("漫剧分享页里没有 window._ROUTER_DATA，链接可能已失效或需要重新分享")

  const loader = data.loaderData || {}
  const page =
    loader[SHARE_PAGE_KEY] ||
    Object.values(loader).find((item) => item?.pageData?.chapter_ids?.length)
  const pageData = page?.pageData
  if (!pageData || !Array.isArray(pageData.chapter_ids) || !pageData.chapter_ids.length) {
    throw new Error("漫剧分享页没有返回分集列表，链接可能已失效，请重新分享一次")
  }

  const chapterIds = pageData.chapter_ids
    .map((vid) => String(vid ?? "").trim())
    .filter((vid) => ID_RE.test(vid))
  if (!chapterIds.length) throw new Error("漫剧分享页里的分集 ID 不合法")

  const schemeParams = page?.linkParams?.schemeParams || {}
  const seriesData = pageData.series_data || {}
  const chapterId = String(pageData.used_chapter_id || schemeParams.vid || "").trim()
  const found = chapterIds.indexOf(chapterId)
  const order = Number(pageData.chapter_order) || (found >= 0 ? found + 1 : 1)

  return {
    title: String(seriesData.title || "").trim(),
    cover: cleanUrl(seriesData.series_cover || seriesData.series_cover_fallback?.[0] || ""),
    intro: String(seriesData.series_intro || "").trim(),
    tags: toTagList(seriesData.category_list?.length ? seriesData.category_list : seriesData.category),
    chapterIds,
    chapterId,
    order,
    videoId: String(pageData.video_id || schemeParams.video_id || "").trim(),
    aid: Number(pageData.aid) || 0,
    total: Number(seriesData.serial_count) || chapterIds.length,
    finalUrl: String(finalUrl || "")
  }
}

/** 分享页只给 30 秒预览，这里按官方那样的提示给调用方复用 */
export function manjuLimitHint(series) {
  if (series?.backend === "server") return "已接入自建服务，可下载集数以服务端实际返回为准"
  const total = Number(series?.total) || Number(series?.episodes?.length) || 0
  const accessible = Number(series?.accessible) || 0
  if (accessible > 0 && total > accessible) {
    return `页面标记开放前 ${accessible} 集，实际以下载结果为准；其余集数可启动内置 API 提高成功率`
  }
  if (accessible > 0) return `页面标记当前开放 ${accessible} 集，实际以下载结果为准`
  return "漫剧正片需要签名接口，可启动插件内置 API 服务"
}

export default class ManjuAPI {
  constructor(config = {}) {
    this.config = config || {}
    this.hongguo = new HongguoAPI(this.config)
    /** 最近一次回退/校验的失败原因，便于排查 */
    this.lastError = null
  }

  get site() {
    return this.hongguo.site
  }

  /** 跟随 kylin 短链 -> 解析最终漫剧分享页 */
  async resolveShare(input) {
    const url = pickUrl(input)
    if (!url) throw new Error("没有找到可用的漫剧分享链接")
    if (!isManjuLink(url)) throw new Error("这不是红果漫剧（kylin.hainanyuyue.com）分享链接")

    let lastError = null
    for (let attempt = 0; attempt < SHARE_TRIES; attempt++) {
      try {
        const res = await this.hongguo.request(url, {
          share: true,
          headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
        })
        const finalUrl = res.url || url
        const html = await res.text().catch(() => "")
        return parseManjuShare(html, finalUrl)
      } catch (err) {
        lastError = err
        if (attempt < SHARE_TRIES - 1) await sleep(700 * (attempt + 1))
      }
    }
    throw new Error(`漫剧分享链接解析失败：${lastError?.message || "未知错误"}`)
  }

  /** 官网播放页 -> 剧集信息（含官网开放集数） */
  async officialSeries(seriesId) {
    const id = String(seriesId ?? "").trim()
    if (!ID_RE.test(id)) throw new Error(`无效的剧集 ID：${seriesId}`)

    const html = await this.hongguo.getText(`${this.site}/player/${id}`)
    const meta = this.hongguo.parseSeriesMeta(html, id)
    if (!meta.episodes.length) throw new Error("官网播放页没有返回分集列表")

    const accessible = Number(extractJson(html, "accessible_episode_cnt")) || meta.episodes.length
    return { id, ...meta, accessible }
  }

  /** 官网剧集页与分享页的匹配度：分集 ID 重合度为主，标题/集数为辅 */
  scoreOfficial(official, share) {
    const vids = new Set(official.episodes.map((item) => item.vid))
    const overlap = share.chapterIds.filter((vid) => vids.has(vid)).length
    const want = normalizeTitle(share.title)
    const titleMatch = Boolean(want) && normalizeTitle(official.title) === want
    const countMatch = official.episodes.length === share.chapterIds.length
    return {
      ok: overlap >= Math.min(3, share.chapterIds.length) || (titleMatch && countMatch),
      overlap,
      titleMatch,
      countMatch
    }
  }

  /** 分享页 -> 官网剧集页：先用 params.video_id，失败再按剧名搜索 */
  async resolveOfficial(share) {
    const tried = []
    let best = null
    const remember = (official, score) => {
      if (!best || score.overlap > best.score.overlap) best = { official, score }
    }
    const attempt = async (id) => {
      try {
        const official = await this.officialSeries(id)
        const score = this.scoreOfficial(official, share)
        tried.push(`${id}(重合${score.overlap}集)`)
        if (score.ok) return official
        remember(official, score)
      } catch (err) {
        tried.push(`${id}(${err.message})`)
      }
      return null
    }

    if (ID_RE.test(share.videoId)) {
      const hit = await attempt(share.videoId)
      if (hit) return hit
    }

    if (share.title) {
      let list = []
      try {
        list = await this.hongguo.search(share.title)
      } catch (err) {
        this.lastError = err
      }
      const limit = Number(this.config.manjuSearchLimit) || 5
      for (const item of list.slice(0, limit)) {
        if (item.seriesId === share.videoId) continue
        const hit = await attempt(item.seriesId)
        if (hit) return hit
      }
    }

    if (best?.score.overlap > 0) return best.official
    const detail = tried.length ? `（已试：${tried.join("；")}）` : ""
    throw new Error(`红果官网没有找到与《${share.title || "该漫剧"}》匹配的剧集页${detail}`)
  }

  /** 漫剧分享链接 -> 统一剧集结构，可直接交给 index.js 的下载流程 */
  async getSeriesByInput(input) {
    if (this.config.apiRequired && (!this.hongguo.serverEnabled() || this.config.preferApiServer === false)) {
      throw new Error("已启用 API 必需模式，请先配置可用的漫剧 API 服务")
    }
    const share = await this.resolveShare(input)
    if (this.hongguo.serverEnabled() && this.config.preferApiServer !== false && ID_RE.test(share.videoId)) {
      let enriched = null
      try {
        const series = await this.hongguo.serverSeries(share.videoId)
        if (this.scoreOfficial(series, share).ok) enriched = series
      } catch (err) {
        this.lastError = err
      }

      const episodes = enriched?.episodes?.length
        ? enriched.episodes
        : share.chapterIds.map((vid, index) => ({ vid, index: index + 1, title: "" }))
      const position = episodes.findIndex((episode) => episode.vid === share.chapterId)
      return {
        seriesId: enriched?.seriesId || share.videoId,
        title: share.title || enriched?.title || "未命名漫剧",
        cover: share.cover || enriched?.cover || "",
        intro: share.intro || enriched?.intro || "",
        tags: share.tags.length ? share.tags : enriched?.tags || [],
        episodeCnt: episodes.length,
        episodes,
        total: episodes.length,
        accessible: 0,
        source: "manju",
        backend: "server",
        shareUrl: share.finalUrl,
        chapterId: share.chapterId,
        startIndex: position >= 0 ? position + 1 : share.order
      }
    }
    const official = await this.resolveOfficial(share)

    return {
      seriesId: official.id,
      title: share.title || official.title,
      cover: share.cover || official.cover,
      intro: share.intro || official.intro,
      tags: share.tags.length ? share.tags : official.tags,
      episodeCnt: official.episodes.length,
      episodes: official.episodes,
      total: official.episodes.length,
      accessible: official.accessible,
      source: "manju",
      backend: "web",
      shareUrl: share.finalUrl,
      chapterId: share.chapterId,
      startIndex: share.order
    }
  }
}
