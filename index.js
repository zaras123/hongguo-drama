import fs from "node:fs"
import path from "node:path"
import plugin from "../../lib/plugins/plugin.js"
import Config from "./components/Config.js"
import HongguoAPI from "./components/HongguoAPI.js"
import ManjuAPI, { isManjuLink, manjuLimitHint } from "./components/ManjuAPI.js"
import SessionAPI from "./components/SessionAPI.js"
import { prepareVideo, assertSent } from "./components/Video.js"
import runtime from "./components/ManagedRuntime.js"
import { parseSetting, settingsHelp } from "./components/Settings.js"

const sessions = new Map()
const activeDownloads = new Set()
let activeParses = 0
let autoApiSetupStarted = false

/**
 * 红果短剧（com.phoenix.read / com.dragon.read）解析下载插件
 *
 * 配置上游 API 后优先按 vid 获取可播 MP4，失败回退官网同集。
 * 官网路线无需 App 签名；漫剧元数据回退官网不改变下载源优先级。
 */
export class HongguoDrama extends plugin {
  constructor() {
    super({
      name: "红果短剧解析",
      dsc: "解析红果短剧/漫剧分享链接与短链，获取全集列表并下载视频",
      event: "message",
      priority: 5000,
      rule: [
        { reg: "^#红果(解析|短剧)\\s*(.*)$", fnc: "parse" },
        { reg: "^#红果下载\\s*(.*)$", fnc: "download" },
        { reg: "^#红果搜索\\s*(.+)$", fnc: "search" },
        { reg: "^#红果帮助$", fnc: "help" },
        { reg: "^#红果(登录|同步登录|登录完成|登录状态)$", fnc: "login", permission: "master" },
        { reg: "^#红果(管理|状态|安装|启动|停止|设备|准备设备|一键配置)(?:\\s+.*)?$", fnc: "manage", permission: "master" },
        { reg: "^#红果配置API(?:\\s+.*)?$", fnc: "manage", permission: "master" },
        { reg: "^#红果(设置|连接|安装App)(?:\\s+.*)?$", fnc: "manage", permission: "master" },
        { reg: "^#红果重载$", fnc: "reloadCommand", permission: "master" },
        {
          reg:
            "(applink\\.novelquickapp\\.com|hongguoduanju\\.com|kylin\\.hainanyuyue\\.com|hainanyuyue\\.com/share/video-animation-share|(?:dragon8662|snssdk143|snssdk2329|sslocal|douyinlite)://|(?:video_series_id|videoSeriesId|series_id|seriesId|book_id|bookId)=)",
          fnc: "autoParse"
        }
      ]
    })

    this.reload()
    /** 会话缓存：记住最近解析的剧，方便直接 "#红果下载 1-3" */
    this.session = sessions
    this.scheduleApiSetup()
  }

  /** 重新读取配置（改配置无需重启） */
  reload() {
    this.config = Config.getConfig()
    this.api = new HongguoAPI(this.config)
    this.manju = new ManjuAPI(this.config)
    this.account = new SessionAPI(this.config)
    this.loadedSettings = JSON.stringify(Config.getSettings())
    return this.config
  }

  refreshSettings() {
    if (JSON.stringify(Config.getSettings()) !== this.loadedSettings) this.reload()
  }

  scheduleApiSetup() {
    if (autoApiSetupStarted || process.env.HONGGUO_DISABLE_AUTO_SETUP || process.env.NODE_TEST_CONTEXT) return
    autoApiSetupStarted = true
    const timer = setTimeout(async () => {
      if (!this.config.apiBuiltin || this.config.apiAutoSetup === false) return
      try {
        const result = await runtime.ensure(this.config, (message) => logger.info(`[红果短剧] ${message}`))
        if (result.started) {
          this.reload()
          logger.mark("[红果短剧] 内置 API 已自动启动")
        } else if (result.reason === "device_required") {
          logger.info("[红果短剧] 未配置设备或外部签名服务，本次使用官网路线")
        }
      } catch (error) {
        logger.warn(`[红果短剧] 内置 API 自动配置未完成: ${error.message}`)
      }
    }, 5000)
    timer.unref?.()
  }

  async manage(e) {
    if (!e.isMaster) { await e.reply("仅限主人操作"); return true }
    if (e.group_id || e.group || e.message_type === "group") {
      await e.reply("请私聊机器人使用红果管理命令")
      return true
    }
    const text = String(e.msg).trim().replace(/^#红果/, "")
    try {
      this.reload()
      if (text === "管理") {
        await e.reply([
          "【红果管理】",
          "一键：#红果一键配置",
          "首次：#红果一键配置 → #红果设备 → #红果设置 设备 <序列号>",
          "设备：#红果连接 地址:端口；#红果安装App APK绝对路径；#红果准备设备",
          "服务：#红果启动 / #红果停止 / #红果状态",
          "远程：#红果配置API <地址> <下载Key> [登录Key]",
          "登录：#红果登录 → App内完成验证 → #红果登录完成",
          "配置：#红果设置；日常：直接发送分享链接"
        ].join("\n"))
      } else if (text === "一键配置" || text === "配置API") {
        await e.reply("正在配置内置 API 运行环境...")
        const result = await runtime.ensure(this.config, (message) => e.reply(message))
        this.reload()
        await e.reply(result.started
          ? "内置 API 已安装并启动。需要账号内容时请发送 #红果登录，在 App 内完成登录。"
          : result.reason === "device_required"
            ? result.installed
              ? "运行环境已安装。请连接并选择 Android 设备后发送 #红果启动。"
              : "内置 API 需要 Android 设备或外部签名服务；Linux 开箱使用官网路线。"
            : result.reason === "auto_start_disabled"
              ? "运行环境已安装，自动启动已在配置中关闭。"
              : result.reason === "auto_setup_disabled"
                ? "自动安装已在配置中关闭，请先发送 #红果设置 API自动安装 开。"
              : "内置 API 运行环境已就绪。")
      } else if (text.startsWith("配置API ")) {
        const [apiServer, apiKey, sessionToken = ""] = text.slice("配置API ".length).trim().split(/\s+/)
        if (!apiServer || !apiKey) throw new Error("写法：#红果配置API <服务地址> <下载密钥> [登录密钥]")
        const url = new URL(apiServer)
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
          throw new Error("API 服务地址必须是不含凭据和查询参数的 HTTP(S) 根地址")
        }
        Config.updateSettings({
          apiServer: url.href.replace(/\/+$/, ""), apiKey, sessionToken,
          apiRequired: true, useApiServer: true, preferApiServer: true
        })
        this.reload()
        await e.reply("远程 API 已配置并设为必需模式。")
      } else if (text === "安装") {
        await e.reply("正在安装插件专用服务环境，进度可通过 #红果状态 查看...")
        await runtime.install(this.config, (message) => e.reply(message))
        await e.reply("安装完成。请发送 #红果设备，选择设备后 #红果准备设备、#红果启动。")
      } else if (text === "启动") {
        const result = await runtime.start(this.config)
        this.reload()
        await e.reply(result.alreadyRunning ? "本地服务已在运行" : "服务已启动，插件连接和密钥已自动配置。请发送 #红果登录。")
      } else if (text === "停止") {
        await runtime.stop()
        await e.reply("插件托管的本地 API 和签名进程已停止，官网解析仍可用。")
      } else if (text === "设备") {
        const list = await runtime.devices(this.config)
        await e.reply(list.length ? list.map((item) => `${item.id}：${item.state}${item.id === this.config.adbDevice ? "（已选）" : ""}`).join("\n") + "\n#红果设置 设备 <序列号>" : "没有在线设备。请启动模拟器或连接安卓设备，再发送 #红果设备。")
      } else if (text.startsWith("连接 ")) {
        await runtime.connect(this.config, text.slice(3).trim())
        this.reload()
        await e.reply("设备已连接并选中，请发送 #红果准备设备。")
      } else if (text.startsWith("安装App ")) {
        await e.reply("正在安装 APK 到所选设备...")
        await runtime.installApp(this.config, text.slice(6).trim().replace(/^"(.*)"$/, "$1"))
        await e.reply("App 安装完成，请发送 #红果准备设备。")
      } else if (text === "准备设备") {
        await e.reply("正在检查设备并准备 Frida，需要已开启 root 的设备，首次可能要下载文件...")
        await e.reply(await runtime.prepareDevice(this.config))
      } else if (text === "设置") {
        await e.reply(settingsHelp)
      } else if (text.startsWith("设置 ")) {
        const setting = parseSetting(text.slice(3))
        const serviceKeys = ["pythonPath", "adbPath", "adbDevice", "managedPort", "managedSignPort", "externalSignServer", "apiServer", "apiKey", "sessionToken"]
        if ((runtime.child || runtime.busy) && serviceKeys.includes(setting.key)) throw new Error("请先等待操作结束并 #红果停止，再修改服务或设备配置")
        Config.updateSettings({ [setting.key]: setting.value })
        this.reload()
        await e.reply(setting.secret ? "密钥已保存，不显示密钥内容" : "设置已保存并生效")
      } else if (text === "状态") {
        const lines = [
          `本地环境：${runtime.installed ? "已安装" : "未安装"}`,
          `服务：${runtime.phase}`,
          `设备：${this.config.adbDevice || "未选择"}`,
          `自动解析：${this.config.enableAutoParse ? "开" : "关"}；自动下载：${this.config.autoDownload ? "开" : "关"}`,
          runtime.error ? `服务提示：${runtime.error}` : ""
        ].filter(Boolean)
        if (this.config.apiServer && this.config.sessionToken && !runtime.busy) {
          try {
            const status = await this.account.request()
            lines.push(`签名：${status.signer_ready ? "在线" : "未就绪"}；会话：${status.credentials_present ? "已配置（身份以App为准）" : "待登录同步"}`)
          } catch { lines.push("API 未连接，请检查本地服务或远程地址") }
        }
        lines.push("#红果管理 查看操作菜单")
        await e.reply(lines.join("\n"))
      } else await e.reply("发送 #红果管理 查看命令")
    } catch (err) {
      await e.reply(`红果操作失败：${err.message}`)
    }
    return true
  }

  async reloadCommand(e) {
    if (!e.isMaster) { await e.reply("仅限主人操作"); return true }
    this.reload()
    await e.reply("红果配置已重载")
    return true
  }

  async login(e) {
    if (!e.isMaster) { await e.reply("仅限主人操作"); return true }
    if (e.group_id || e.group || e.message_type === "group") {
      await e.reply("请私聊机器人使用红果登录管理命令")
      return true
    }
    this.reload()
    const command = String(e.msg).trim()
    const action = command === "#红果登录" ? "start" : ["#红果同步登录", "#红果登录完成"].includes(command) ? "sync" : ""
    try {
      if (action === "sync") await e.reply("正在同步 App 会话，请保持 App 在线并打开一个视频页面...")
      const status = await this.account.request(action)
      if (action === "start") {
        await e.reply("已启动红果 App。请在 App 内完成登录和验证码，再发送 #红果登录完成。")
      } else {
        await e.reply([
          `会话凭证：${status.credentials_present ? "已配置" : "缺失"}`,
          `设备参数：${status.device_present ? "已配置" : "缺失"}`,
          `签名服务：${status.signer_ready ? "在线" : "未就绪"}`,
          action === "sync" ? "本次会话已同步到下载服务。" : "",
          "账号身份请以 App 登录页面为准；下载能力请发送一条分享链接验证。"
        ].filter(Boolean).join("\n"))
      }
    } catch (err) {
      await e.reply(`红果登录操作失败：${err.message}`)
    }
    return true
  }

  /** 把它当成漫剧链接吗（配置关闭时直接拒绝） */
  useManju(input) {
    if (!isManjuLink(input)) return false
    if (this.config.manjuEnable === false) {
      throw new Error("红果漫剧解析已在配置里关闭（manjuEnable: false）")
    }
    return true
  }

  /** 分享链接/ID -> 剧集信息：漫剧走 ManjuAPI，其余走红果官网 */
  async parseSeries(input) {
    return this.withParseSlot(() => this.useManju(input)
      ? this.manju.getSeriesByInput(input) : this.api.getSeriesByInput(input))
  }

  async withParseSlot(action) {
    if (activeParses >= (Number(this.config.maxConcurrentParses) || 4)) throw new Error("解析任务已满，请稍后重试")
    activeParses++
    try { return await action() } finally { activeParses-- }
  }

  /** 单集提示语里的数据源说明 */
  sourceHint(series) {
    return series?.source === "manju" ? manjuLimitHint(series) : ""
  }

  /** 整集重试次数：默认 2，允许配置成 0 表示不重试 */
  getEpisodeRetries() {
    const raw = this.config?.episodeRetries
    if (raw === undefined || raw === null || raw === "") return 2
    const value = Number(raw)
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 2
  }

  /** 会话 key：群聊按群 + 用户隔离，私聊按用户隔离 */
  getSessionKey(e) {
    const uid = e?.user_id ?? e?.sender?.user_id ?? "unknown"
    const gid = e?.group_id ?? e?.sender?.group_id
    const bot = e?.self_id ?? e?.bot?.uin ?? "default"
    return gid ? `${bot}:g:${gid}:${uid}` : `${bot}:f:${uid}`
  }

  setSeries(e, data) {
    this.session.set(this.getSessionKey(e), { ...data, time: Date.now(), ttl: Number(this.config.sessionTTL) || 1800 })
    if (this.session.size > 500) {
      const now = Date.now()
      for (const [key, item] of this.session) {
        if (now - item.time > item.ttl * 1000) this.session.delete(key)
      }
      if (this.session.size > 500) {
        const oldest = [...this.session.entries()].sort((a, b) => a[1].time - b[1].time)[0]
        if (oldest) this.session.delete(oldest[0])
      }
    }
  }

  getSeries(e) {
    const key = this.getSessionKey(e)
    const item = this.session.get(key)
    if (!item) return null
    if (Date.now() - item.time > item.ttl * 1000) {
      this.session.delete(key)
      return null
    }
    return item
  }

  /** 从命令参数或消息里取出链接/短链/ID */
  pickInput(text = "") {
    const msg = String(text)
    const url = msg.match(/https?:\/\/[^\s"'<>（）()【】,，。；;]+/)?.[0]
    if (url) return url.replace(/[。；;，,]+$/, "")
    const scheme = msg.match(
      /(?:dragon8662|snssdk143|snssdk2329|sslocal|douyinlite):\/\/[^\s"'<>（）()【】,，。；;]+/i
    )?.[0]
    if (scheme) return scheme.replace(/[。；;，,]+$/, "")
    const id = msg.match(/\d{15,25}/)?.[0]
    return id || ""
  }

  async parse(e) {
    this.refreshSettings()
    const input = this.pickInput(e.msg)
    if (!input) {
      await e.reply(
        "请带上红果短剧/漫剧分享链接或剧集 ID\n" +
          "例如：#红果解析 https://applink.novelquickapp.com/xxxx\n" +
          "　　　#红果解析 https://kylin.hainanyuyue.com/s/xxxx"
      )
      return true
    }
    return this.doParse(e, input)
  }

  async autoParse(e) {
    this.refreshSettings()
    if (!Config.getConfig().enableAutoParse) return false
    if (/^#红果/.test(String(e.msg).trim())) return false
    const input = this.pickInput(e.msg)
    if (!input) return false
    return this.doParse(e, input, { quiet: true, autoDownload: true })
  }

  /** 解析分享链接 -> 剧集信息 */
  async doParse(e, input, { quiet = false, autoDownload = false } = {}) {
    try {
      if (!quiet) {
        await e.reply(isManjuLink(input) ? "🔍 正在解析红果漫剧链接..." : "🔍 正在解析红果短剧链接...")
      }

      const series = await this.parseSeries(input)
      if (!series?.episodes?.length) {
        await e.reply("❎ 未解析到剧集信息，请确认链接来自红果短剧分享，或改用剧集 ID")
        return false
      }

      this.setSeries(e, series)

      const lines = [
        `《${series.title}》`,
        `集数：${series.episodes.length}${series.tags?.length ? `　题材：${series.tags.slice(0, 4).join("/")}` : ""}`,
        series.source === "manju" ? `可下载：${this.sourceHint(series)}` : "",
        series.intro ? `简介：${series.intro.slice(0, 60)}${series.intro.length > 60 ? "..." : ""}` : "",
        "",
        `发送「#红果下载 1-3」按集数下载（最多 ${this.config.maxEpisodesPerRequest} 集/次）`
      ].filter(Boolean)

      const msg = []
      if (series.cover) msg.push(segment.image(series.cover))
      msg.push("\n" + lines.join("\n"))
      await e.reply(msg)

      if (autoDownload && this.config.autoDownload !== false) {
        try {
          const plan = this.resolveAutoDownloadIndexes(series)
          if (plan.note) await e.reply(`⚠️ ${plan.note}`)
          if (plan.indexes.length) await this.downloadSeries(e, series, plan.indexes)
        } catch (err) {
          logger.error(`[红果短剧] 自动下载失败: ${err?.stack || err}`)
          await e.reply(`❎ 自动下载失败：${err.message}`)
        }
      }
      return true
    } catch (err) {
      logger.error(`[红果短剧] 解析失败: ${err?.stack || err}`)
      await e.reply(`❎ 解析失败：${err.message}`)
      return false
    }
  }

  async search(e) {
    this.refreshSettings()
    const keyword = String(e.msg).replace(/^#红果搜索\s*/, "").trim()
    if (!keyword) {
      await e.reply("请输入要搜索的剧名，例如：#红果搜索 逆袭")
      return true
    }
    try {
      await e.reply(`🔍 正在搜索《${keyword}》...`)
      const list = await this.withParseSlot(() => this.api.search(keyword))
      if (!list.length) {
        await e.reply("❎ 没有搜到相关短剧，换个关键词试试")
        return false
      }
      const show = list.slice(0, Number(this.config.searchLimit) || 8)
      const lines = show.map(
        (item, i) => `${i + 1}. 《${item.title}》${item.total ? `共 ${item.total} 集` : ""}\n   ID：${item.seriesId}`
      )
      await e.reply(`${lines.join("\n")}\n\n发送「#红果解析 <ID>」查看详情`)
      return true
    } catch (err) {
      logger.error(`[红果短剧] 搜索失败: ${err?.stack || err}`)
      await e.reply(`❎ 搜索失败：${err.message}`)
      return false
    }
  }

  async download(e) {
    this.refreshSettings()
    const text = String(e.msg).replace(/^#红果下载\s*/, "").trim()
    const input = this.pickInput(text)
    const rangeText = input ? text.replace(input, "").trim() : text

    let series = null
    try {
      series = input ? await this.parseSeries(input) : this.getSeries(e)
    } catch (err) {
      await e.reply(`❎ 解析失败：${err.message}`)
      return false
    }

    if (!series?.episodes?.length) {
      await e.reply("请先发送「#红果解析 <链接或ID>」，或使用「#红果下载 <链接> 1-3」")
      return false
    }

    this.setSeries(e, series)

    let indexes
    try {
      indexes = this.parseRange(rangeText, series.episodes.length)
    } catch (err) {
      await e.reply(`❎ ${err.message}`)
      return false
    }

    return await this.downloadSeries(e, series, indexes)
  }

  /** 发链接自动下载时决定选集：默认下分享链接指向的那一集 */
  resolveAutoDownloadIndexes(series) {
    const total = series.episodes.length
    const raw = String(this.config.autoDownloadRange ?? "shared").trim().toLowerCase()

    if (!raw || ["shared", "share", "分享集", "分享"].includes(raw)) {
      const index = Math.max(1, Math.min(Number(series.startIndex) || 1, total))
      const accessible = Number(series.accessible) || 0
      const note = series.source === "manju" && accessible > 0 && index > accessible
        ? `页面标记仅开放前 ${accessible} 集，仍优先尝试分享的第 ${index} 集`
        : ""
      return { indexes: [index], note }
    }

    if (["first", "首集", "第一集"].includes(raw)) return { indexes: [1] }
    return { indexes: this.parseRange(raw, total) }
  }

  /** 首次优先使用上游按 vid 解密；失败后的整集重试固定回官网。 */
  episodePreference(attempt) {
    if (this.config.apiRequired) return "server"
    if (attempt > 0) return "site"
    return this.api.serverEnabled() && this.config.preferApiServer !== false ? "server" : "site"
  }

  /** 下载一组已经选好的集数 */
  async downloadSeries(e, series, indexes) {
    const key = this.getSessionKey(e)
    if (activeDownloads.has(key)) {
      await e.reply("当前会话已有下载任务，请等待完成")
      return true
    }
    if (activeDownloads.size >= (Number(this.config.maxConcurrentDownloads) || 2)) {
      await e.reply("下载任务已满，请稍后重试")
      return true
    }
    activeDownloads.add(key)
    // Keep credentials/settings stable even when another command reloads configuration.
    const worker = Object.create(this)
    worker.config = this.config
    worker.api = this.api
    try {
      return await worker.runDownloads(e, series, indexes)
    } finally {
      activeDownloads.delete(key)
    }
  }

  async runDownloads(e, series, indexes) {
    const max = Number(this.config.maxEpisodesPerRequest) || 3
    if (indexes.length > max) {
      await e.reply(`⚠️ 一次最多下载 ${max} 集，已自动取前 ${max} 集`)
      indexes = indexes.slice(0, max)
    }

    await e.reply(`📥 《${series.title}》开始下载第 ${indexes.join("、")} 集，请稍候...`)

    for (const index of indexes) {
      const episode = series.episodes[index - 1]
      const name = `${series.title} 第${index}集`
      // 允许把 episodeRetries 明确写成 0（表示失败不重试）
      const retries = this.getEpisodeRetries()

      let file = null
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          // 自建服务按 vid 解密后提供可播 MP4；失败后回退官网明文直链。
          const url = await this.api.getEpisodeUrl(series.seriesId, episode.vid, {
            prefer: this.episodePreference(attempt),
            index,
            quality: this.config.streamQuality,
            attempt
          })
          const fromServer = this.api.isServerUrl(url)
          file = await this.api.download(url, name, {
            idleTimeout: fromServer
              ? Number(this.config.apiServerIdleTimeout) || 300000
              : Number(this.config.downloadIdleTimeout) || 60000,
            retries: Number(this.config.downloadRetries) || 0
          }).catch(async (err) => {
            if (!fromServer || this.config.apiRequired) throw err
            this.api.lastServerError = err.message
            try {
              const fallback = await this.api.getEpisodeUrl(series.seriesId, episode.vid, {
                prefer: "site",
                attempt
              })
              return await this.api.download(fallback, name, {
                idleTimeout: Number(this.config.downloadIdleTimeout) || 60000,
                retries: Number(this.config.downloadRetries) || 0
              })
            } catch (siteError) {
              throw new Error(`自建服务：${err.message}；官网回退：${siteError.message}`)
            }
          })
          break
        } catch (err) {
          logger.error(`[红果短剧] 第 ${index} 集失败(${attempt + 1}/${retries + 1}): ${err?.stack || err}`)
          if (attempt >= retries) {
            const hint =
              series.source === "manju" && Number(series.accessible) > 0 && index > Number(series.accessible)
                ? `\n${manjuLimitHint(series)}`
                : ""
            await e.reply(`❎ 第 ${index} 集下载失败：${err.message}${hint}`)
          } else {
            await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
          }
        }
      }
      if (!file) continue
      let sendPath = file.path
      try {
        sendPath = await prepareVideo(file.path, this.config)
        await this.sendVideo(e, sendPath, name)
        logger.mark(`[红果短剧] 已发送《${name}》`)
      } catch (err) {
        logger.error(`[红果短剧] 视频处理或发送失败：${err.message}`)
        await e.reply(`第 ${index} 集已下载，但视频处理或发送失败：${err.message}`)
      } finally {
        if (this.config.cleanupAfterSend) {
          if (sendPath !== file.path) await this.api.remove(sendPath)
          await this.api.remove(file.path)
        }
      }
    }
    return true
  }

  /** 解析 "1-3,5" / "第2集" / "全部" 这类选集表达式 */
  parseRange(text = "", total = 0) {
    const raw = String(text).replace(/[第集\s]/g, "")
    if (!raw) return [1]
    if (/^(all|全部|全集)$/i.test(raw)) return Array.from({ length: total }, (_, i) => i + 1)

    const result = new Set()
    for (const part of raw.split(/[,，、]/)) {
      if (!part) continue

      const range = part.match(/^(\d+)[-~到](\d+)$/)
      if (range) {
        const start = Number(range[1])
        const end = Number(range[2])
        if (start < 1 || end < start) throw new Error(`集数区间无效：${part}`)
        if (start > total) throw new Error(`超出范围：第 ${start} 集（共 ${total} 集）`)
        for (let i = start; i <= Math.min(end, total); i++) result.add(i)
        continue
      }

      const single = part.match(/^(\d+)$/)
      if (single) {
        const n = Number(single[1])
        if (n < 1 || n > total) throw new Error(`超出范围：第 ${n} 集（共 ${total} 集）`)
        result.add(n)
        continue
      }

      throw new Error(`无法识别的选集写法：${part}`)
    }

    const list = [...result].sort((a, b) => a - b).filter((n) => n <= total)
    if (!list.length) throw new Error("没有可下载的集数")
    return list
  }

  async sendVideo(e, filePath, title) {
    if (!fs.existsSync(filePath)) throw new Error("本地文件不存在")
    const filename = `${title}.mp4`
    // Native icqq uses fs.upload(file, pid, name); Yunzai adapter wrappers use sendFile(file, name).
    const sendFile = e.group?.fs?.upload ? () => e.group.fs.upload(filePath, "/", filename) :
      e.group?.sendFile ? () => e.group.sendFile(filePath, filename) :
      e.friend?.sendFile ? () => e.friend.sendFile(filePath, filename) : null
    if (this.config.sendType === "file") {
      if (!sendFile) throw new Error("当前适配器不支持文件上传")
      assertSent(await sendFile())
      return
    }
    try {
      let payload = path.resolve(filePath)
      if (this.config.videoTransport === "base64") {
        const size = (await fs.promises.stat(filePath)).size
        if (size > (Number(this.config.maxBase64SizeMB) || 30) * 1048576) {
          throw new Error("视频超过 base64 发送上限，请使用共享路径或调大 maxBase64SizeMB")
        }
        payload = `base64://${(await fs.promises.readFile(filePath)).toString("base64")}`
      }
      assertSent(await e.reply(segment.video(payload)))
    } catch (err) {
      logger.warn(`[红果短剧] 视频直发失败，改用群文件: ${err.message}`)
      if (sendFile) assertSent(await sendFile())
      else throw err
    }
  }

  async help(e) {
    this.refreshSettings()
    const mode = this.api.serverEnabled()
      ? `自建API服务（${this.config.apiServer}，优先）＋ 官网兜底`
      : "红果官网解析"
    await e.reply(
      [
        "【红果短剧/漫剧解析】",
        "群里直接发链接　自动解析并下载分享集",
        "#红果解析 <分享链接|短链|剧集ID>　解析剧集信息",
        "#红果下载 <链接> 1-3　按集数下载并发送视频",
        "#红果下载 2　下载上次解析剧集的第 2 集",
        "#红果搜索 剧名　搜索短剧",
        "#红果帮助　显示本帮助",
        "主人私聊：#红果管理　安装、设备、服务、登录、设置",
        "主人：#红果重载　重新读取配置",
        "",
        `当前配置：单次最多 ${this.config.maxEpisodesPerRequest} 集，发送方式 ${this.config.sendType}`,
        `数据源：${mode}`,
        `漫剧解析：${this.config.manjuEnable === false ? "已关闭" : "已开启"}`,
        `自动下载：${this.config.autoDownload === false ? "已关闭" : `已开启（${this.config.autoDownloadRange || "shared"}）`}`,
        "漫剧链接示例：https://kylin.hainanyuyue.com/s/xxxx"
      ].join("\n")
    )
    return true
  }
}
