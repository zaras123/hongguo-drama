import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { followResponse, readText, shareUrl } from "./Http.js"
import { validateVideo } from "./Video.js"

/**
 * 红果短剧官网（hongguoduanju.com）数据源。
 *
 * 官网播放页是服务端渲染的：分集 vid 列表、剧集信息和单集 MP4 直链都内嵌在 HTML 的
 * JSON 数据里，普通 GET 即可拿到，不需要 App 侧的 x-gorgon/x-argus 签名头。
 * App 私有接口（/novel/player/*）在无签名时会返回 200 + 空 body，因此这里不使用。
 *
 * 另外支持可选的“自建 API 服务”数据源（例如 zhangbaio/hongguo 的 server.py）：
 * 服务端用签名预言机拿直链、纯离线 spade 解密后通过 /stream 串流可播 mp4。
 * 配置 apiServer 后优先走它，失败自动回退官网解析。
 */

export const SITE_ORIGIN = "https://hongguoduanju.com"

export const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

const SERIES_ID_RE = /^\d{6,30}$/

/** JSON 字符串里的转义 URL 与 HTML 实体还原，并去掉会让 CDN 只回分片的 Range 参数 */
export function cleanUrl(raw) {
  return String(raw || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/([?&])Range=[^&]*/gi, "$1")
    .replace(/[?&]$/, "")
    .trim()
}

function decodeEntities(text) {
  return String(text)
    .replace(/&quot;/g, '\\"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

/** 分享链接里可能承载剧集 ID 的参数名，按可信度从高到低排列 */
const ID_PARAM_KEYS = [
  "video_series_id",
  "videoSeriesId",
  "series_id_str",
  "series_id",
  "seriesId",
  "share_series_id",
  "shareSeriesId",
  "book_id",
  "bookId",
  "album_id",
  "albumId",
  "collection_id",
  "collectionId",
  "video_id",
  "videoId",
  "item_id",
  "itemId",
  "group_id",
  "groupId",
  "sid",
  "vid"
]

/** 反复 URL 解码（分享链接常见二次编码），解码失败就停在上一步 */
function decodeRepeatedly(text, rounds = 3) {
  let out = String(text || "")
  for (let i = 0; i < rounds; i++) {
    try {
      const next = decodeURIComponent(out)
      if (next === out) break
      out = next
    } catch {
      break
    }
  }
  return out
}

/**
 * 从任意文本（URL、HTML、scheme 参数、JSON）里按可信度顺序提取候选 ID。
 * 提取结果只是候选，最终由 getSeriesByInput 逐个校验。
 */
function extractIdCandidates(haystack) {
  const source = String(haystack || "")
  const found = []
  const push = (value) => {
    const id = String(value ?? "").trim()
    if (SERIES_ID_RE.test(id) && !found.includes(id)) found.push(id)
  }

  push(source.trim())
  for (const key of ID_PARAM_KEYS) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(`(?:["']|\\b)${escapedKey}["']?\\s*[:=]\\s*["']?(\\d{6,30})`, "gi")
    for (const match of source.matchAll(pattern)) push(match[1])
  }
  for (const match of source.matchAll(/\/player\/(\d{6,30})/gi)) push(match[1])
  for (const match of source.matchAll(/\/detail\/(\d{6,30})/gi)) push(match[1])
  return found
}

/** 提取页面里的 JS / meta 跳转目标（HTTP 302 之外的情况） */
function extractRedirectTargets(html) {
  const source = decodeRepeatedly(decodeEntities(String(html || "")))
  const targets = []
  const push = (raw) => {
    const target = cleanUrl(decodeRepeatedly(decodeEntities(raw))).replace(/["'>;]+$/, "")
    if (!target || targets.includes(target)) return
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return
    targets.push(target)
  }

  for (const tag of source.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/http-equiv\s*=\s*["']?refresh/i.test(tag[0])) continue
    const content = tag[0].match(/content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    const value = content?.[1] ?? content?.[2] ?? content?.[3] ?? ""
    push(value.match(/(?:^|;)\s*url\s*=\s*(.+)$/i)?.[1] || "")
  }

  const patterns = [
    /(?:window\.|document\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/gi,
    /location\.(?:replace|assign)\(\s*["']([^"']+)["']/gi,
    /["'](?:url|redirect|target|landing_page|scheme|schemeUri|jump_schema|jumpSchema)["']\s*:\s*["']((?:\\.|[^"'])+)["']/gi
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) push(match[1])
  }
  return targets
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

/** 取出 `"key": <json>` 里的结构（对象/数组/标量），失败返回 null */
export function extractJson(text, key) {
  const source = String(text || "")
  const needle = `"${key}"`
  let from = 0

  while (from < source.length) {
    const idx = source.indexOf(needle, from)
    if (idx < 0) return null
    from = idx + needle.length

    const colon = source.indexOf(":", from)
    if (colon < 0) return null
    if (source.slice(from, colon).trim()) continue

    let i = colon + 1
    while (i < source.length && /\s/.test(source[i])) i++
    const ch = source[i]

    if (ch === "[" || ch === "{") {
      const raw = sliceBalanced(source, i)
      if (!raw) continue
      try {
        return JSON.parse(decodeEntities(raw))
      } catch {
        continue
      }
    }

    const token = /^("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/.exec(source.slice(i))
    if (!token) continue
    try {
      return JSON.parse(decodeEntities(token[1]))
    } catch {
      continue
    }
  }
  return null
}

/** 取出 `"key": "字符串"` 并反转义 */
export function extractString(text, key) {
  const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`"${escapedKey}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)
  const m = pattern.exec(String(text || ""))
  if (!m) return ""
  try {
    return JSON.parse(`"${m[1]}"`)
  } catch {
    return m[1]
  }
}

export function toTagList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === "string" ? item : item?.name || item?.title || ""))
    .map((item) => cleanUrl(item).trim())
    .filter(Boolean)
}

function sanitizeFileName(name) {
  return String(name || "")
    .replace(/[^\p{L}\p{N} ._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default class HongguoAPI {
  constructor(config = {}) {
    this.config = config || {}
    this.site = String(this.config.siteOrigin || SITE_ORIGIN).replace(/\/+$/, "")
    this.ua = this.config.userAgent || DEFAULT_UA
    this.timeout = Number(this.config.requestTimeout) || 30000
    this.downloadTimeout = Number(this.config.downloadTimeout) || 600000
    const configuredServer = String(this.config.apiServer || "").trim()
    this.server = ["builtin", "local", "auto", "内置"].includes(configuredServer.toLowerCase())
      ? `http://127.0.0.1:${Number(this.config.managedPort) || 18780}`
      : configuredServer.replace(/\/+$/, "")
    this.apiKey = String(this.config.apiKey || "")
    this.serverTimeout = Number(this.config.apiServerTimeout) || 180000
    /** 最近一次自建服务报错，便于排查为什么回退了官网 */
    this.lastServerError = ""
  }

  /** 是否配置并启用了自建 API 服务 */
  serverEnabled() {
    return Boolean(this.server) && this.config.useApiServer !== false
  }

  requireApi() {
    if (this.config.apiRequired && !this.serverEnabled()) {
      throw new Error("已启用 API 必需模式，请先配置可用的 API 服务")
    }
  }

  /** 判断某个下载地址是不是自建服务的串流地址 */
  isServerUrl(url) {
    if (!this.server) return false
    try {
      const target = new URL(url)
      const expected = new URL(`${this.server}/stream`)
      return target.origin === expected.origin && target.pathname === expected.pathname
    } catch {
      return false
    }
  }

  baseHeaders(extra = {}) {
    return {
      "User-Agent": this.ua,
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: `${this.site}/`,
      ...extra
    }
  }

  /** 页面请求在返回前读完有限大小的响应体；超时包含 DNS、跳转和 body。 */
  async request(url, options = {}) {
    const timeout = Number(options.timeout) || this.timeout
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await followResponse(url, {
        headers: this.baseHeaders(options.headers),
        share: options.share === true,
        trustedOrigin: !options.share && this.site !== SITE_ORIGIN ? new URL(this.site).origin : undefined,
        signal: controller.signal
      })
      const body = await readText(res, Number(this.config.maxPageSizeMB) > 0
        ? this.config.maxPageSizeMB * 1048576 : 4 * 1048576)
      return { ...res, text: async () => body }
    } catch (err) {
      const reason = String(err?.message || err)
      if (controller.signal.aborted) {
        throw new Error(`请求超时（${timeout}ms）`)
      }
      throw new Error(`请求失败：${reason}`)
    } finally {
      controller.abort()
      clearTimeout(timer)
    }
  }

  async getText(url, options = {}) {
    const res = await this.request(url, {
      ...options,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(options.headers || {})
      }
    })
    if (!res.ok) throw new Error(`页面请求失败（HTTP ${res.status}）：${url}`)
    return await res.text()
  }

  /** 自建 API 数据接口通过请求头鉴权，超时覆盖响应体读取。 */
  async serverRequest(pathname, params = {}, options = {}) {
    if (!this.serverEnabled()) throw new Error("未配置红果 API 服务地址")

    let url
    try {
      url = new URL(`${this.server}${pathname}`)
    } catch {
      throw new Error(`红果 API 服务地址不合法：${this.server}`)
    }
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue
      url.searchParams.set(key, String(value))
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Number(options.timeout) || this.serverTimeout)
    try {
      const res = await fetch(url.href, {
        headers: this.baseHeaders({ Accept: "application/json",
          ...(this.apiKey ? { "X-API-Key": this.apiKey } : {}) }),
        redirect: "error", signal: controller.signal
      })
      if (res.status === 401) throw new Error("红果 API 服务鉴权失败（401），请检查 apiKey")
      if (!res.ok) throw new Error(`红果 API 服务返回 HTTP ${res.status}，请在服务端检查登录态和签名状态`)
      try {
        return await res.json()
      } catch (err) {
        if (controller.signal.aborted) throw err
        throw new Error("红果 API 服务返回的不是合法 JSON")
      }
    } catch (err) {
      if (controller.signal.aborted) throw new Error("红果 API 服务请求超时")
      throw err
    } finally {
      controller.abort()
      clearTimeout(timer)
    }
  }

  /** 自建服务：剧集信息 -> 与官网解析一致的结构 */
  async serverSeries(seriesId) {
    const payload = await this.serverRequest("/episodes", { series_id: seriesId })
    const meta = payload?.meta || {}
    const rawEps = Array.isArray(payload?.episodes) ? payload.episodes : []
    const episodes = rawEps
      .map((item, i) => ({
        vid: String(item?.vid || "").trim(),
        index: Number(item?.index) || i + 1,
        title: String(item?.title || "")
      }))
      .filter((item) => SERIES_ID_RE.test(item.vid))
      .sort((a, b) => a.index - b.index)

    if (!episodes.length) throw new Error("红果 API 服务没有返回该剧的分集列表")

    return {
      seriesId: String(meta.series_id || seriesId),
      title: String(meta.title || "未命名短剧"),
      cover: cleanUrl(meta.cover || rawEps.find((e) => e?.cover)?.cover || ""),
      intro: String(meta.intro || ""),
      tags: Array.isArray(meta.category) ? meta.category.filter(Boolean).map(String) : [],
      episodeCnt: Number(meta.episode_cnt) || episodes.length,
      episodes,
      total: episodes.length,
      source: "server"
    }
  }

  /** 自建服务：搜索 */
  async serverSearch(keyword, limit) {
    const payload = await this.serverRequest("/search", {
      q: keyword,
      limit: Number(limit) > 0 ? Number(limit) : undefined
    })
    const rows = Array.isArray(payload?.results) ? payload.results : []
    return rows
      .map((row) => ({
        seriesId: String(row?.series_id || "").trim(),
        title: String(row?.title || "").trim(),
        cover: cleanUrl(row?.cover || ""),
        intro: String(row?.intro || ""),
        total: Number(row?.episode_cnt) || 0,
        tags: [],
        score: row?.score ?? "",
        hot: String(row?.hot || ""),
        vid: String(row?.vid || "")
      }))
      .filter((item) => SERIES_ID_RE.test(item.seriesId) && item.title)
  }

  /** 自建服务的解密串流地址（可播 mp4，支持 Range） */
  buildStreamUrl({ seriesId, vid, index, quality } = {}) {
    if (!this.serverEnabled()) return ""
    const url = new URL(`${this.server}/stream`)
    if (vid) url.searchParams.set("vid", String(vid))
    else {
      if (seriesId) url.searchParams.set("series_id", String(seriesId))
      if (index) url.searchParams.set("ep", String(index))
    }
    url.searchParams.set("quality", String(quality || this.config.streamQuality || "best"))
    if (this.apiKey) url.searchParams.set("api_key", this.apiKey)
    return url.href
  }

  /** 从分享链接、短链、scheme 或页面跳转里收集所有候选 series_id */
  async collectShare(input) {
    const text = String(input ?? "").trim()
    if (!text) throw new Error("没有提供分享链接或剧集 ID")
    if (text.length > 16384) throw new Error("分享内容过长")
    let lastResolveError = null
    const shareTexts = []

    const candidates = []
    const seen = new Set()
    const addText = (value) => {
      const source = String(value || "")
      shareTexts.push(decodeRepeatedly(source))
      let added = false
      for (const item of [source, decodeRepeatedly(source)]) {
        for (const id of extractIdCandidates(item)) {
          if (candidates.includes(id) || candidates.length >= 20) continue
          candidates.push(id)
          added = true
        }
      }
      return added
    }

    const visit = async (value, depth) => {
      if (depth > 2 || seen.size >= 10) return
      const current = String(value || "").trim()
      if (!current || seen.has(current)) return
      seen.add(current)
      if (/^https?:\/\//i.test(current)) shareUrl(current)

      if (addText(current)) return

      const embedded =
        current.match(/(?:https?|dragon8662|snssdk143|snssdk2329|sslocal|douyinlite):\/\/[^\s"'<>]+/gi) || []
      for (const target of embedded) {
        if (target === current) continue
        await visit(target, depth + 1)
        if (candidates.length) return
      }

      if (!/^https?:\/\//i.test(current)) return

      let res
      try {
        res = await this.request(current, { share: true })
      } catch (err) {
        lastResolveError = err
        return
      }

      const finalUrl = res.url || current
      addText(finalUrl)
      const body = await res.text().catch(() => "")
      addText(body)

      for (const target of extractRedirectTargets(body)) {
        await visit(target, depth + 1)
        if (candidates.length) return
      }
    }

    await visit(text, 0)
    return { candidates, shareTexts, lastResolveError }
  }

  async collectSeriesIdCandidates(input) {
    return (await this.collectShare(input)).candidates
  }

  /** 分享链接 / 纯数字 ID -> 第一个候选 series_id */
  async resolveSeriesId(input) {
    const { candidates, lastResolveError } = await this.collectShare(input)
    if (!candidates.length) {
      const cause = lastResolveError ? `（${lastResolveError.message}）` : ""
      throw new Error(
        "未能从分享链接中解析出剧集 ID，短链可能已失效或该链接不含内容信息；" +
          "可打开红果分享页复制带 series_id 的链接后重试" +
          cause
      )
    }
    return candidates[0]
  }

  /** 从播放页/详情页 HTML 里解析剧集信息 */
  parseSeriesMeta(html, seriesId) {
    const vids = extractJson(html, "vid_list")
    const list = Array.isArray(vids)
      ? vids.map((vid) => String(vid || "").trim()).filter((vid) => SERIES_ID_RE.test(vid))
      : []

    const title =
      extractString(html, "series_name") ||
      extractString(html, "series_title") ||
      cleanUrl(extractString(html, "name")) ||
      "未命名短剧"
    const cover = cleanUrl(extractString(html, "series_cover") || extractString(html, "cover_url"))
    const intro = extractString(html, "series_intro") || extractString(html, "video_desc")
    const tags = toTagList(extractJson(html, "tags")).length
      ? toTagList(extractJson(html, "tags"))
      : toTagList(extractJson(html, "category_list"))
    const episodeCnt =
      Number(extractJson(html, "episode_cnt")) ||
      Number(extractJson(html, "series_episode_info")?.episode_cnt) ||
      list.length

    return {
      seriesId: String(seriesId),
      title,
      cover,
      intro,
      tags,
      episodeCnt,
      episodes: list.map((vid, i) => ({ vid, index: i + 1, title: "" }))
    }
  }

  /** 剧集 ID -> 完整分集列表（含标题、封面、简介、题材） */
  async getSeries(seriesId) {
    this.requireApi()
    const sid = String(seriesId ?? "").trim()
    if (!SERIES_ID_RE.test(sid)) throw new Error(`无效的剧集 ID：${seriesId}`)

    if (this.serverEnabled() && (this.config.apiRequired || this.config.preferApiServer !== false)) {
      try {
        const result = await this.serverSeries(sid)
        this.lastServerError = ""
        return result
      } catch (err) {
        this.lastServerError = err.message
        if (this.config.apiRequired) throw new Error(`API 必需模式：${err.message}`)
      }
    }

    return await this.siteSeries(sid)
  }

  /** 官网解析：剧集 ID -> 剧集信息 */
  async siteSeries(seriesId) {
    const sid = String(seriesId ?? "").trim()
    let meta = this.parseSeriesMeta(await this.getText(`${this.site}/player/${sid}`), sid)

    if (!meta.episodes.length) {
      const detailHtml = await this.getText(`${this.site}/detail?series_id=${sid}`).catch(() => "")
      if (detailHtml) {
        const fallback = this.parseSeriesMeta(detailHtml, sid)
        meta = {
          ...meta,
          ...Object.fromEntries(Object.entries(fallback).filter(([, v]) => v && (!Array.isArray(v) || v.length))),
          episodes: fallback.episodes
        }
      }
    }

    if (!meta.episodes.length) throw new Error("官网没有返回该剧的分集列表，可能已下架或 ID 有误")

    return { ...meta, total: meta.episodes.length, source: "web" }
  }

  /** 分享链接/ID -> 剧集信息 */
  async getSeriesByInput(input) {
    const { candidates, shareTexts, lastResolveError } = await this.collectShare(input)
    if (!candidates.length) {
      const cause = lastResolveError ? `（${lastResolveError.message}）` : ""
      throw new Error(
        "未能从分享链接中解析出剧集 ID，短链可能已失效或该链接不含内容信息；" +
          "可打开红果分享页复制带 series_id 的链接后重试" +
          cause
      )
    }

    let lastError = null
    for (const seriesId of candidates) {
      try {
        const series = await this.getSeries(seriesId)
        if (series?.episodes?.length) {
          const sources = shareTexts.join("\n")
          const currentIds = [
            ...sources.matchAll(/\/player\/\d{6,30}\/(\d{6,30})/g),
            ...sources.matchAll(/(?:[?&"']|\b)(?:vid|chapter_id|used_chapter_id|video_id)["']?\s*[:=]\s*["']?(\d{6,30})/g)
          ].map((match) => match[1])
          const position = series.episodes.findIndex((episode) => currentIds.includes(episode.vid))
          return { ...series, startIndex: position >= 0 ? position + 1 : 1 }
        }
      } catch (err) {
        lastError = err
      }
    }

    const detail = lastError ? `；最后一个候选错误：${lastError.message}` : ""
    throw new Error(`已解析出候选 ID，但都未能获取分集列表${detail}；若链接只是推广页，请改用「#红果搜索 剧名」`)
  }

  /**
   * 取单集 MP4 直链。直链带时效签名，必须每次实时获取，不能缓存复用。
   * prefer = "server" 走自建服务的解密串流；"site" 走官网内嵌的明文 MP4。
   */
  async getEpisodeUrl(seriesId, vid, options = {}) {
    this.requireApi()
    const prefer =
      this.config.apiRequired ? "server"
        : options.prefer || (this.serverEnabled() && this.config.preferApiServer !== false ? "server" : "site")
    if (prefer === "server") {
      const url = this.buildStreamUrl({ seriesId, vid, index: options.index, quality: options.quality })
      if (url) return url
      if (this.config.apiRequired) throw new Error("已启用 API 必需模式，但没有可用的 API 流地址")
    }
    return await this.siteEpisodeUrl(seriesId, vid, options)
  }

  /**
   * 官网解析：取单集明文 MP4 直链（优先 contentUrl，兜底 main_url）。
   * 重试时先用 Range 探测直链，跳过已失效的缓存地址。
   */
  async siteEpisodeUrl(seriesId, vid, options = {}) {
    const attempt = Math.max(0, Math.trunc(Number(options.attempt) || 0))
    const retryQuery = attempt > 0 ? `hg_retry=${attempt}-${Date.now()}` : ""
    const candidates = []
    if (seriesId) {
      const base = `${this.site}/player/${String(seriesId).trim()}/${String(vid).trim()}`
      candidates.push(retryQuery ? `${base}?${retryQuery}` : base)
    }
    const fallbackBase = `${this.site}/player/_/${String(vid).trim()}`
    candidates.push(retryQuery ? `${fallbackBase}?${retryQuery}` : fallbackBase)

    let lastError = null
    let lastDirect = ""
    for (const url of candidates) {
      try {
        const html = await this.getText(url, attempt > 0
          ? { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } }
          : {})
        const raw = extractString(html, "contentUrl") || extractString(html, "main_url")
        const direct = cleanUrl(raw)
        if (/^https?:\/\//i.test(direct)) {
          lastDirect = direct
          if (attempt === 0 || await this.probeMediaUrl(direct)) return direct
          lastError = new Error("播放直链暂时不可用")
          continue
        }
        lastError = new Error("页面里没有可用的播放地址")
      } catch (err) {
        lastError = err
      }
    }
    const detail = lastDirect ? `${lastError?.message || "直链探测失败"}：${lastDirect}` : lastError?.message || "未知错误"
    throw new Error(`未能获取 ${vid} 的播放直链：${detail}`)
  }

  /** 重试时用小范围请求探测直链，避免把平台缓存中的 404 地址交给下载器。 */
  async probeMediaUrl(url) {
    const controller = new AbortController()
    const timeout = Math.min(Number(this.config.requestTimeout) || 30000, 15000)
    const timer = setTimeout(() => controller.abort(new Error("媒体探测超时")), timeout)
    try {
      const res = await followResponse(url, {
        headers: this.baseHeaders({
          Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
          Range: "bytes=0-1"
        }),
        signal: controller.signal
      })
      const type = res.headers.get("content-type") || ""
      const ok = res.ok && !/json|text\//i.test(type)
      res.body?.destroy()
      return ok
    } catch {
      return false
    } finally {
      controller.abort()
      clearTimeout(timer)
    }
  }

  /** 关键词搜索 */
  async search(keyword, page = 1) {
    this.requireApi()
    const word = String(keyword ?? "").trim()
    if (!word) throw new Error("搜索关键词不能为空")

    if (this.serverEnabled() && (this.config.apiRequired || this.config.preferApiServer !== false)) {
      try {
        const list = await this.serverSearch(word, this.config.searchLimit)
        if (list.length) return list
      } catch (err) {
        this.lastServerError = err.message
        if (this.config.apiRequired) throw new Error(`API 必需模式：${err.message}`)
      }
    }

    return await this.siteSearch(word, page)
  }

  /** 官网解析：关键词搜索 */
  async siteSearch(keyword, page = 1) {
    const word = String(keyword ?? "").trim()
    const html = await this.getText(`${this.site}/search/${encodeURIComponent(word)}?page=${Number(page) || 1}`)
    const rows = extractJson(html, "searchList")
    if (!Array.isArray(rows)) throw new Error("官网搜索页结构可能已变化，未能解析搜索结果")

    const list = rows.map((row) => {
      const data = row?.video_data || row || {}
      const seriesId = String(
        data.series_id || data.seriesId || (SERIES_ID_RE.test(String(row?.keyword || "")) ? row.keyword : "")
      ).trim()
      const title = String(data.series_title || data.series_name || row?.name || "").trim()
      return {
        seriesId,
        title,
        cover: cleanUrl(data.series_cover || data.cover || data.cover_url || ""),
        intro: String(data.series_intro || data.video_desc || "").trim(),
        total: Number(data.episode_cnt) || Number(data.series_episode_info?.episode_cnt) || 0,
        tags: toTagList(data.tags).length ? toTagList(data.tags) : toTagList(data.category_list)
      }
    })

    const seen = new Set()
    return list.filter((item) => {
      if (!SERIES_ID_RE.test(item.seriesId) || !item.title || seen.has(item.seriesId)) return false
      seen.add(item.seriesId)
      return true
    })
  }

  /**
   * 下载直链到本地：先写 .part，完整落盘后再改名，避免半截文件被当成成品。
   * @returns {Promise<{path: string, size: number, contentType: string}>}
   */
  async download(url, name, options = {}) {
    if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("无效的下载地址")

    const tempDir = options.tempDir || this.config.tempDir || "./temp"
    const dir = path.isAbsolute(tempDir) ? tempDir : path.resolve(process.cwd(), tempDir)
    await fsp.mkdir(dir, { recursive: true })

    const base = sanitizeFileName(name) || `hongguo-${Date.now()}`
    const target = path.join(dir, `${base}-${randomUUID()}.mp4`)
    const part = `${target}.part`

    const rawRetries = options.retries ?? this.config.downloadRetries ?? 2
    const retries = Math.max(0, Math.min(5, Math.trunc(Number(rawRetries)) || 0))
    const maxBytes =
      options.maxBytes ??
      (Number(this.config.maxFileSizeMB) > 0 ? Number(this.config.maxFileSizeMB) * 1024 * 1024 : 0)

    let lastError = null
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.downloadOnce(url, part, target, { ...options, maxBytes })
        if (this.isServerUrl(url)) this.lastServerError = ""
        return result
      } catch (err) {
        lastError = err
        if (this.isServerUrl(url)) this.lastServerError = err.message
        await fsp.rm(part, { force: true }).catch(() => {})
        if (attempt < retries) await sleep(1000 * (attempt + 1))
      }
    }
    throw new Error(`下载失败：${lastError?.message || "未知错误"}`)
  }

  async downloadOnce(url, part, target, options = {}) {
    const controller = new AbortController()
    const idleTimeout = Number(options.idleTimeout) || 60000
    const totalTimer = setTimeout(() => controller.abort(new Error("下载总时长超限")), this.downloadTimeout)
    let idleTimer = null
    const bumpIdle = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(new Error(`下载停滞超过 ${idleTimeout}ms`)), idleTimeout)
    }

    bumpIdle()
    let handle = null
    try {
      const fromServer = this.isServerUrl(url)
      const res = await followResponse(url, {
        headers: this.baseHeaders({
          Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
          ...(options.headers || {})
        }),
        trustedOrigin: fromServer ? new URL(this.server).origin : undefined,
        noRedirect: fromServer,
        signal: controller.signal
      })

      if (!res.ok) throw new Error(res.status === 401 && this.isServerUrl(url)
        ? "自建服务 API Key 无效（HTTP 401），请检查 apiKey" : `HTTP ${res.status}`)
      if (!res.body) throw new Error("响应没有内容")
      if (res.status !== 200 || res.headers.has("content-range")) throw new Error("下载接口返回分段响应，未收到完整视频")
      if (res.headers.has("content-encoding") && res.headers.get("content-encoding") !== "identity") {
        throw new Error("视频接口返回了非原始编码内容")
      }

      const contentType = res.headers.get("content-type") || ""
      if (/json|text\//i.test(contentType)) throw new Error("下载接口返回了错误页面、文本或 JSON，未收到视频")
      const total = Number(res.headers.get("content-length")) || 0
      if (options.maxBytes && total && total > options.maxBytes) {
        throw new Error(
          `文件 ${(total / 1048576).toFixed(1)}MB 超过限制 ${(options.maxBytes / 1048576).toFixed(1)}MB`
        )
      }

      handle = await fsp.open(part, "w")
      const stream = res.body
      let size = 0

      for await (const chunk of stream) {
        bumpIdle()
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buf.length
        if (options.maxBytes && size > options.maxBytes) {
          throw new Error(`文件超过限制 ${(options.maxBytes / 1048576).toFixed(1)}MB`)
        }
        let offset = 0
        while (offset < buf.length) {
          const { bytesWritten } = await handle.write(buf, offset, buf.length - offset)
          if (!bytesWritten) throw new Error("文件写入失败")
          offset += bytesWritten
        }
        options.onProgress?.(size, total)
      }

      await handle.close()
      handle = null
      if (!size) throw new Error("下载内容为空")
      if (total && !res.headers.get("content-encoding") && size !== total) throw new Error("视频下载不完整")
      clearTimeout(idleTimer)
      await validateVideo(part, this.config)
      controller.signal.throwIfAborted()

      await fsp.rm(target, { force: true }).catch(() => {})
      await fsp.rename(part, target)
      return { path: target, size, contentType }
    } catch (err) {
      controller.abort()
      throw err instanceof Error ? err : new Error(String(err))
    } finally {
      clearTimeout(idleTimer)
      controller.abort()
      clearTimeout(totalTimer)
      if (handle) await handle.close().catch(() => {})
    }
  }

  /** 删除本地临时文件 */
  async remove(file) {
    if (!file) return
    await fsp.rm(file, { force: true }).catch(() => {})
  }

  /** 供外部检查目录是否可写 */
  static ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }
}
