import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import { pathToFileURL, fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import net from "node:net"

const root = fileURLToPath(new URL("../", import.meta.url))
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "hongguo-test-"))
const pluginDir = path.join(sandbox, "plugins", "hongguo-drama")
await fs.cp(root, pluginDir, { recursive: true })
await fs.mkdir(path.join(sandbox, "lib", "plugins"), { recursive: true })
await fs.copyFile(new URL("plugin-stub.js", import.meta.url), path.join(sandbox, "lib", "plugins", "plugin.js"))
globalThis.logger = { info() {}, warn() {}, error() {}, mark() {} }
globalThis.segment = { image: (file) => ({ type: "image", file }), video: (file) => ({ type: "video", file }) }
const { HongguoDrama } = await import(pathToFileURL(path.join(pluginDir, "index.js")))
const { default: HongguoAPI } = await import(pathToFileURL(path.join(pluginDir, "components", "HongguoAPI.js")))
const { default: ManjuAPI } = await import(pathToFileURL(path.join(pluginDir, "components", "ManjuAPI.js")))
const { default: SessionAPI } = await import(pathToFileURL(path.join(pluginDir, "components", "SessionAPI.js")))
const { prepareVideo } = await import(pathToFileURL(path.join(pluginDir, "components", "Video.js")))
const { default: Config } = await import(pathToFileURL(path.join(pluginDir, "components", "Config.js")))
const { ManagedRuntime } = await import(pathToFileURL(path.join(pluginDir, "components", "ManagedRuntime.js")))
const { parseSetting } = await import(pathToFileURL(path.join(pluginDir, "components", "Settings.js")))
const sid = "7664958856774044697"
const vid = "7664961183094410265"
const token = "management-secret"
const state = { streamHits: 0, streamVid: "", quality: "", login: false, key: "", broken: false, metadataBroken: false }
const mp4 = await fs.readFile(new URL("fixtures/video.mp4", import.meta.url))
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")
  const json = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)) }
  if (url.pathname.startsWith("/admin/session")) {
    if (req.headers["x-session-token"] !== token) return json(401, {})
    if (url.pathname.endsWith("/sync")) state.login = true
    return json(200, { credentials_present: state.login, device_present: true, signer_ready: true, account_verified: false })
  }
  state.key = req.headers["x-api-key"] || url.searchParams.get("api_key")
  if (state.key !== "download-key") return json(401, {})
  if (url.pathname === "/episodes") {
    if (state.metadataBroken) return json(503, { error: "metadata unavailable" })
    return json(200, { meta: { title: "Fixture", series_id: sid }, episodes: [{ vid, index: 1 }] })
  }
  if (url.pathname === "/stream") {
    state.streamHits++
    state.streamVid = url.searchParams.get("vid")
    state.quality = url.searchParams.get("quality")
    if (state.broken) return json(200, { error: "not a video" })
    res.writeHead(200, { "content-type": "video/mp4", "content-length": mp4.length })
    return res.end(mp4)
  }
  json(404, {})
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const base = `http://127.0.0.1:${server.address().port}`
const settings = { apiServer: base, apiKey: "download-key", sessionToken: token, tempDir: path.join(sandbox, "videos"),
  ffprobePath: process.env.HG_FFPROBE || "ffprobe",
  streamQuality: "1080p", episodeRetries: 0, downloadRetries: 0, cleanupAfterSend: true }
function instance() {
  const inst = new HongguoDrama()
  inst.config = { ...inst.config, ...settings }
  inst.api = new HongguoAPI(inst.config)
  return inst
}

test.after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fs.rm(sandbox, { recursive: true, force: true })
})

test("session HTTP client authenticates and synchronizes without returning credentials", async () => {
  const api = new SessionAPI(settings)
  assert.equal((await api.request()).credentials_present, false)
  assert.equal((await api.request("sync")).credentials_present, true)
  assert.equal((await api.request()).account_verified, false)
  await assert.rejects(new SessionAPI({ ...settings, sessionToken: "wrong" }).request(), /鉴权失败/)
})

test("login command rejects non-owners and group chats before contacting API", async () => {
  const inst = instance()
  inst.reload = () => { throw new Error("should not load credentials") }
  const messages = []
  await inst.login({ msg: "#红果登录", isMaster: false, reply: async (m) => messages.push(m) })
  await inst.login({ msg: "#红果登录", isMaster: true, group_id: 1, reply: async (m) => messages.push(m) })
  assert.match(messages[0], /主人/)
  assert.match(messages[1], /私聊/)
})

test("share URL to HTTP episodes, download, send and cleanup", async () => {
  const inst = instance()
  let videos = 0
  const e = { self_id: 1, user_id: 2, group_id: 3, msg: `https://hongguoduanju.com/player/${sid}/${vid}`,
    reply: async (message) => {
      if (message?.type === "video") {
        assert.deepEqual(await fs.readFile(message.file), mp4)
        videos++
      }
      return { message_id: 1 }
    } }
  await inst.autoParse(e)
  assert.equal(videos, 1)
  assert.equal(state.quality, "1080p")
  assert.deepEqual(await fs.readdir(settings.tempDir), [])
  const nextInstance = instance()
  assert.equal(nextInstance.getSeries(e).seriesId, sid)
  assert.equal(nextInstance.getSeries({ ...e, self_id: 99 }), null)
})

test("failed manju metadata still downloads shared episode five through upstream vid", async () => {
  const inst = instance()
  const before = state.streamHits
  const messages = []
  const vids = ["7664960983332310041", "7664960983332310042", "7664960983332310043", "7664960983332310044", vid]
  const share = "window._ROUTER_DATA=" + JSON.stringify({ loaderData: { "video-animation-share_page": {
    pageData: { chapter_ids: vids, used_chapter_id: vid, chapter_order: 5, video_id: sid,
      series_data: { title: "Fixture", serial_count: 5 } }
  } } })
  inst.manju = new ManjuAPI(inst.config)
  inst.manju.hongguo.request = async () => ({ url: "https://hainanyuyue.com/share/video-animation-share", text: async () => share })
  inst.manju.hongguo.getText = async () => assert.fail("configured API must not require the official site")
  inst.api.siteEpisodeUrl = async () => assert.fail("upstream success must not request the site video")
  const e = { user_id: 7, msg: "https://kylin.hainanyuyue.com/s/fixture", reply: async (message) => {
    if (message?.type === "video") assert.deepEqual(await fs.readFile(message.file), mp4)
    messages.push(message)
    return { message_id: 7 }
  } }
  state.metadataBroken = true
  try { await inst.autoParse(e) } finally { state.metadataBroken = false }
  assert.equal(inst.getSeries(e).backend, "server")
  assert.equal(inst.getSeries(e).startIndex, 5)
  assert.equal(inst.getSeries(e).episodes.length, 5)
  assert.equal(inst.getSeries(e).episodes[4].vid, vid)
  assert.equal(state.streamHits, before + 1)
  assert.equal(state.streamVid, vid)
  assert.equal(state.quality, "1080p")
  assert.equal(messages.filter((message) => message?.type === "video").length, 1)
  assert.deepEqual(await fs.readdir(settings.tempDir), [])
})

test("failed upstream falls back to the same manju episode with zero retries and never substitutes episode one", async () => {
  const inst = instance()
  const before = state.streamHits
  const messages = []
  const siteCalls = []
  inst.api.siteEpisodeUrl = async (seriesId, videoId) => {
    siteCalls.push({ seriesId, videoId })
    throw new Error("site episode unavailable")
  }
  state.broken = true
  try {
    await inst.downloadSeries({ user_id: 8, reply: async (message) => { messages.push(message); return true } },
      { title: "Fixture", source: "manju", backend: "web", seriesId: sid, accessible: 3,
        episodes: Array.from({ length: 5 }, () => ({ vid })) }, [5])
  } finally { state.broken = false }
  assert.equal(state.streamHits, before + 1)
  assert.deepEqual(siteCalls, [{ seriesId: sid, videoId: vid }])
  assert.ok(messages.some((message) => typeof message === "string" && /第 5 集下载失败/.test(message) && /site episode unavailable/.test(message)))
  assert.ok(!messages.some((message) => message?.type === "video"))
  assert.deepEqual(await fs.readdir(settings.tempDir), [])
})

test("false video send result falls back to group file", async () => {
  const file = path.join(sandbox, "fallback.mp4")
  await fs.writeFile(file, mp4)
  let sent = 0
  await instance().sendVideo({ reply: async () => false, group: { fs: { upload: async (input, pid, name) => {
    assert.equal(input, file); assert.equal(pid, "/"); assert.equal(name, "test.mp4")
    sent++; return { message_id: 2 }
  } } } }, file, "test")
  assert.equal(sent, 1)
})

test("remote adapter receives base64 video", async () => {
  const inst = instance()
  inst.config.videoTransport = "base64"
  const file = path.join(sandbox, "remote.mp4")
  await fs.writeFile(file, mp4)
  await inst.sendVideo({ reply: async (message) => {
    assert.equal(message.file, `base64://${mp4.toString("base64")}`)
    return { message_id: 3 }
  } }, file, "test")
})

test("send failure does not download again and releases files", async () => {
  const inst = instance()
  inst.config.episodeRetries = 2
  const before = state.streamHits
  const messages = []
  inst.sendVideo = async () => { throw new Error("send failed") }
  await inst.downloadSeries({ user_id: 5, reply: async (m) => messages.push(m) },
    { title: "Test", seriesId: sid, episodes: [{ vid }] }, [1])
  assert.equal(state.streamHits, before + 1)
  assert.ok(messages.some((message) => message.includes("已下载")))
  assert.deepEqual(await fs.readdir(settings.tempDir), [])
})

test("JSON errors are never sent as videos", async () => {
  state.broken = true
  try {
    const api = new HongguoAPI(settings)
    await assert.rejects(api.download(api.buildStreamUrl({ vid }), "bad", { retries: 0 }), /JSON/)
    assert.deepEqual(await fs.readdir(settings.tempDir), [])
  } finally { state.broken = false }
})

test("simultaneous duplicate requests are rejected until first finishes", async () => {
  const inst = instance()
  let release
  const pending = new Promise((resolve) => { release = resolve })
  inst.runDownloads = async () => pending
  const replies = []
  const e = { user_id: 6, reply: async (m) => replies.push(m) }
  const first = inst.downloadSeries(e, {}, [])
  await inst.downloadSeries(e, {}, [])
  assert.match(replies[0], /已有下载任务/)
  release(true)
  await first
})

test("H.264 conversion produces a real playable MP4", { skip: !process.env.HG_TEST_FFMPEG }, async () => {
  const file = path.join(sandbox, "mpeg4.mp4")
  const ffmpegPath = process.env.HG_FFMPEG || "ffmpeg"
  const ffprobePath = process.env.HG_FFPROBE || "ffprobe"
  execFileSync(ffmpegPath, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=5",
    "-t", "0.4", "-c:v", "mpeg4", file], { windowsHide: true })
  const converted = await prepareVideo(file, { transcodeVideo: true, maxFileSizeMB: 2, ffmpegPath, ffprobePath })
  assert.notEqual(converted, file)
  const info = JSON.parse(execFileSync(ffprobePath, ["-v", "error", "-show_streams", "-of", "json", converted]))
  assert.equal(info.streams[0].codec_name, "h264")
  assert.equal(info.streams[0].pix_fmt, "yuv420p")
})

test("management commands match their rules and reject non-owner/group usage", async () => {
  const inst = instance()
  for (const text of ["#红果安装", "#红果启动", "#红果停止", "#红果设备", "#红果准备设备",
    "#红果设置 设备 emulator-5554", "#红果连接 127.0.0.1:5555", "#红果安装App /tmp/base.apk"]) {
    assert.ok(inst.rule.some((rule) => rule.fnc === "manage" && new RegExp(rule.reg).test(text)), text)
  }
  assert.ok(inst.rule.some((rule) => rule.fnc === "login" && new RegExp(rule.reg).test("#红果登录完成")))
  const messages = []
  await inst.manage({ msg: "#红果安装", isMaster: false, reply: async (m) => messages.push(m) })
  await inst.manage({ msg: "#红果设置 登录密钥 secret", isMaster: true, group_id: 1, reply: async (m) => messages.push(m) })
  assert.match(messages[0], /主人/)
  assert.match(messages[1], /私聊/)
})

test("settings persist quotes and paths, mask secrets and refresh another instance", async () => {
  assert.deepEqual(parseSetting('ADB "C:/Program Files/adb.exe"'), { key: "adbPath", value: "C:/Program Files/adb.exe", secret: false })
  assert.equal(parseSetting("自动下载 关").value, false)
  assert.throws(() => parseSetting("端口 22"))
  assert.throws(() => parseSetting("未知 anything"))
  assert.throws(() => parseSetting("服务地址 https://user:pass@example.com"))
  const inst = instance()
  const other = instance()
  const messages = []
  await inst.manage({ isMaster: true, msg: "#红果设置 登录密钥 never-echo-this-secret", reply: async (m) => messages.push(m) })
  assert.equal(Config.getSettings().sessionToken, "never-echo-this-secret")
  assert.ok(!messages.join().includes("never-echo-this-secret"))
  other.refreshSettings()
  assert.equal(other.config.sessionToken, "never-echo-this-secret")
})

test("managed lifecycle provisions credentials, rejects busy ports and stops owned process", { skip: !process.env.HG_TEST_PYTHON }, async () => {
  const root = path.join(sandbox, "managed-fixture")
  const upstream = path.join(root, "upstream")
  const python = path.join(root, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python")
  await fs.mkdir(upstream, { recursive: true })
  await fs.mkdir(path.dirname(python), { recursive: true })
  await fs.writeFile(python, "fixture")
  await fs.writeFile(path.join(root, "ready.json"), JSON.stringify({ files: ["server.py", "sign_server.py"] }))
  await fs.writeFile(path.join(upstream, "sign_server.py"), "# fixture")
  await fs.writeFile(path.join(upstream, "config.json"), "{}")
  await fs.copyFile(new URL("fixtures/server.py", import.meta.url), path.join(upstream, "server.py"))
  const managed = new ManagedRuntime(root)
  Object.defineProperty(managed, "python", { value: process.env.HG_TEST_PYTHON })
  const port = await new Promise((resolve) => {
    const probe = net.createServer()
    probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close(() => resolve(port)) })
  })
  const settings = { managedPort: port, managedSignPort: port === 18781 ? 18782 : 18781, externalSignServer: "http://127.0.0.1:1" }
  try {
    assert.equal(managed.installed, true)
    await managed.start(settings)
    assert.equal(managed.phase, "运行中")
    const saved = Config.getSettings()
    assert.equal(saved.apiServer, 'http://127.0.0.1:' + port)
    assert.notEqual(saved.sessionToken, saved.apiKey)
    const key = saved.sessionToken
    assert.equal((await managed.start(settings)).alreadyRunning, true)
    const response = await new SessionAPI(saved).request()
    assert.equal(response.credentials_present, false)
    await assert.rejects(managed.connect({}, "127.0.0.1:5555"), /先.*停止/)
    await assert.rejects(managed.freePort(port), /占用/)
    await managed.stop()
    assert.equal(managed.child, null)
    await managed.freePort(port)
    await managed.start(settings)
    assert.equal(Config.getSettings().sessionToken, key)
    // Bot termination closes the control pipe, which must close the owned API too.
    managed.child.stdin.end()
    await managed.closed
    assert.equal(managed.child, null)
    await managed.freePort(port)
    await fs.writeFile(path.join(upstream, "server.py"), "raise RuntimeError('do-not-expose-upstream-secret')\n")
    await assert.rejects(managed.start(settings), /API 服务退出/)
    assert.equal(managed.phase, "启动失败")
    assert.ok(!managed.error.includes("do-not-expose-upstream-secret"))
    assert.equal(managed.child, null)
    await managed.freePort(port)
  } finally { await managed.stop() }
})
