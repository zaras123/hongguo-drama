import fs from "node:fs"
import path from "node:path"
import net from "node:net"
import { randomBytes } from "node:crypto"
import { spawn, execFile } from "node:child_process"
import { promisify } from "node:util"
import Config from "./Config.js"

const run = promisify(execFile)
const secret = () => randomBytes(32).toString("hex")
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class ManagedRuntime {
  constructor(root = path.join(Config.dir, "runtime")) {
    this.root = root
    this.child = null
    this.busy = false
    this.phase = "未启动"
    this.error = ""
  }

  get python() {
    return path.join(this.root, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python")
  }

  get installed() {
    try {
      const ready = JSON.parse(fs.readFileSync(path.join(this.root, "ready.json"), "utf8"))
      return fs.existsSync(this.python) && Array.isArray(ready.files) &&
        ["server.py", "sign_server.py"].every((name) => ready.files.includes(name)) &&
        ready.files.every((name) => typeof name === "string" &&
          fs.statSync(path.join(this.root, "upstream", name)).isFile())
    } catch { return false }
  }

  async exclusive(action) {
    if (this.busy) throw new Error("服务操作进行中，请发送 #红果状态 查看进度")
    this.busy = true
    this.error = ""
    try { return await action() } catch (error) {
      this.error = error.message
      throw error
    } finally { this.busy = false }
  }

  async install(config, notify = async () => {}) {
    return this.exclusive(async () => {
      if (this.child) throw new Error("请先 #红果停止 再安装")
      this.phase = "安装中"
      try {
        await run(config.pythonPath || "python", ["--version"], { timeout: 10000, windowsHide: true })
      } catch {
        this.phase = "安装失败"
        throw new Error("未找到 Python，请安装 Python 3.10+ 后使用 #红果设置 Python 可执行文件路径")
      }
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 })
      const command = path.join(Config.dir, "server", "bootstrap.py")
      await new Promise((resolve, reject) => {
        const child = spawn(config.pythonPath || "python", [command, "--root", this.root], {
          windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
          env: { ...process.env, PYTHONIOENCODING: "utf-8" }
        })
        let buffer = ""
        child.stdout.setEncoding("utf8")
        child.stdout.on("data", (data) => {
          buffer += data
          const lines = buffer.split(/\r?\n/)
          buffer = lines.pop().slice(-2000)
          for (const line of lines) {
            try {
              const item = JSON.parse(line)
              if (item.progress) { this.phase = item.progress; Promise.resolve(notify(item.progress)).catch(() => {}) }
              if (item.error) this.error = item.error
            } catch { /* Only structured installer messages are surfaced. */ }
          }
        })
        child.once("error", () => { this.error = "无法启动 Python 安装器" })
        child.once("close", (code) => {
          this.phase = code === 0 ? "已安装" : "安装失败"
          if (code === 0) resolve()
          else reject(new Error(this.error || "安装失败，请检查网络、磁盘和 Python 环境后重试"))
        })
      })
    })
  }

  async freePort(port) {
    await new Promise((resolve, reject) => {
      const check = net.createServer()
      check.once("error", () => reject(new Error(`端口 ${port} 已被占用，请通过 #红果设置 更换端口`)))
      check.listen(port, "127.0.0.1", () => check.close(resolve))
    })
  }

  async devices(config) {
    try {
      const { stdout } = await run(config.adbPath || "adb", ["devices", "-l"], { timeout: 10000, windowsHide: true })
      return stdout.split(/\r?\n/).map((line) => line.match(/^(\S+)\s+(device|offline|unauthorized)(?:\s|$)/))
        .filter(Boolean).map((match) => ({ id: match[1], state: match[2] }))
    } catch {
      throw new Error("无法运行 ADB，请通过 #红果设置 ADB 可执行文件路径 配置")
    }
  }

  async connect(config, address) {
    return this.exclusive(async () => {
      if (this.child) throw new Error("请先 #红果停止 再修改设备")
      if (!/^(?:[A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\]):\d{1,5}$/.test(address)) {
        throw new Error("设备连接地址格式：127.0.0.1:5555")
      }
      try {
        await run(config.adbPath || "adb", ["connect", address], { timeout: 15000, windowsHide: true })
      } catch { throw new Error("ADB 连接失败，请检查设备地址和端口") }
      const devices = await this.devices(config)
      if (!devices.some((item) => item.id === address && item.state === "device")) throw new Error("设备未上线，请检查 ADB 端口和授权")
      Config.updateSettings({ adbDevice: address })
      return devices
    })
  }

  async installApp(config, apk) {
    return this.exclusive(async () => {
      if (this.child) throw new Error("请先 #红果停止 再修改设备")
      if (!config.adbDevice) throw new Error("请先通过 #红果设备 和 #红果设置 设备 选择在线设备")
      if (!path.isAbsolute(apk) || !apk.toLowerCase().endsWith(".apk") || !fs.existsSync(apk)) {
        throw new Error("请提供 Bot 所在机器上 APK 的完整绝对路径")
      }
      try {
        const { stdout } = await run(config.adbPath || "adb", ["-s", config.adbDevice, "install", "-r", apk],
          { timeout: 180000, windowsHide: true })
        if (!stdout.includes("Success")) throw new Error()
      } catch { throw new Error("APK 安装未成功，请检查设备状态和安装权限") }
    })
  }

  async prepareDevice(config) {
    return this.exclusive(async () => {
      if (this.child) throw new Error("请先 #红果停止 再准备设备")
      if (!this.installed || !config.adbDevice) throw new Error("请先 #红果安装 并选择在线设备")
      this.phase = "准备设备中"
      try {
        const { stdout } = await run(this.python, [path.join(Config.dir, "server", "prepare_device.py"),
          "--adb", config.adbPath || "adb", "--device", config.adbDevice],
        { timeout: 180000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } })
        const lines = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line))
        this.phase = "设备已准备"
        return lines.at(-1)?.progress
      } catch (error) {
        this.phase = "设备准备失败"
        let detail = "设备准备失败，请检查 ADB、root 和网络"
        try { detail = JSON.parse(String(error.stdout).trim().split(/\r?\n/).at(-1)).error || detail } catch {}
        throw new Error(detail)
      }
    })
  }

  async ensure(config, notify = async () => {}) {
    if (config.apiAutoSetup === false) return { installed: this.installed, started: false, reason: "auto_setup_disabled" }
    if (!this.installed) await this.install(config, notify)
    if (this.child) return { installed: true, started: true, alreadyRunning: true }
    if (config.apiAutoStart === false) return { installed: true, started: false, reason: "auto_start_disabled" }
    const needsDevice = !config.externalSignServer
    if (needsDevice && !config.adbDevice) return { installed: true, started: false, reason: "device_required" }
    await this.start(config)
    return { installed: true, started: true }
  }

  async start(config) {
    return this.exclusive(async () => {
      if (this.child) return { alreadyRunning: true }
      if (!this.installed) throw new Error("请先发送 #红果安装")
      const localSigner = !config.externalSignServer
      const port = Number(config.managedPort) || 18780
      const signPort = Number(config.managedSignPort) || 18781
      if (port === signPort) throw new Error("服务端口和签名端口不能相同")
      await this.freePort(port)
      if (localSigner) {
        await this.freePort(signPort)
        const devices = await this.devices(config)
        if (!devices.some((item) => item.id === config.adbDevice && item.state === "device")) {
          throw new Error("所选设备未在线，发送 #红果设备 或 #红果连接 地址:端口")
        }
      }
      const settingsPath = path.join(this.root, "service.json")
      const previous = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {}
      const settings = {
        port, signPort, localSigner, signServer: config.externalSignServer || `http://127.0.0.1:${signPort}`,
        sessionToken: previous.sessionToken || secret(), adminToken: previous.adminToken || secret(),
        apiKey: previous.apiKey || `hg_${secret()}`, adbPath: config.adbPath || "adb", adbDevice: config.adbDevice || "",
        fridaHost: config.fridaHost || "127.0.0.1:27042", fridaBin: config.fridaBin || "/data/local/tmp/frida-server",
        ffmpegDir: path.isAbsolute(config.ffmpegPath || "") ? path.dirname(config.ffmpegPath) : ""
      }
      fs.writeFileSync(`${settingsPath}.tmp`, JSON.stringify(settings), { mode: 0o600 })
      fs.renameSync(`${settingsPath}.tmp`, settingsPath)
      this.phase = "启动中"
      const child = spawn(this.python, [path.join(Config.dir, "server", "managed_runner.py"), "--root", this.root], {
        windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, PYTHONIOENCODING: "utf-8" }
      })
      this.child = child
      this.closed = new Promise((resolve) => child.once("close", () => {
        if (this.child === child) { this.child = null; this.phase = this.error ? "服务退出" : "已停止" }
        resolve()
      }))
      child.stdin.on("error", () => {})
      child.once("error", () => { this.error = "无法启动本地服务" })
      let buffer = ""
      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (data) => {
        buffer += data
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop().slice(-2000)
        for (const line of lines) {
          try {
            const item = JSON.parse(line)
            if (["api", "signer"].includes(item.role) && Number.isInteger(item.exitCode)) {
              this.error = (item.role === "api" ? "API" : "签名") + " 服务退出（代码 " + item.exitCode + "），请检查 Python 依赖、设备和端口"
            } else if (item.error === "launch_failed") this.error = "无法创建服务进程，请检查 Python 和运行目录权限"
          } catch { /* Never forward raw upstream logs or credentials to chat. */ }
        }
      })
      const apiServer = `http://127.0.0.1:${port}`
      try {
        let ready = false
        let probeError = ""
        for (let attempt = 0; attempt < 30; attempt++) {
          if (!this.child) throw new Error(this.error || "本地服务提前退出")
          try {
            const response = await fetch(`${apiServer}/admin/session`, {
              headers: { "X-Session-Token": settings.sessionToken }, signal: AbortSignal.timeout(7000), redirect: "error"
            })
            if (response.ok) { await response.json(); ready = true; break }
            probeError = `HTTP ${response.status}`
            await response.body?.cancel()
          } catch (error) {
            probeError = error.cause?.code || error.name || "连接失败"
          }
          await sleep(500)
        }
        if (!ready) throw new Error(`API 启动超时（${probeError}），请检查 Python 环境和设备状态`)
        Config.updateSettings({ apiServer, apiKey: settings.apiKey, sessionToken: settings.sessionToken, useApiServer: true, preferApiServer: true })
        this.phase = "运行中"
        return { apiServer }
      } catch (error) {
        await this.stopChild()
        this.error = error.message
        this.phase = "启动失败"
        throw error
      }
    })
  }

  async stopChild() {
    if (!this.child) return
    this.child.stdin.end("stop\n")
    await this.closed
  }

  async stop() {
    return this.exclusive(async () => {
      await this.stopChild()
      this.phase = "已停止"
    })
  }
}

const key = Symbol.for("hongguo.managedRuntime")
export default (globalThis[key] ||= new ManagedRuntime())
