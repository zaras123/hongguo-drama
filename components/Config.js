import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)

/** 插件根目录（components/ 的上一级），与插件文件夹名称无关 */
const pluginDir = fileURLToPath(new URL("..", import.meta.url))

/** 优先使用 Yunzai 自带的 yaml；缺失时退回内置的扁平解析器 */
let YAML = null
try {
  const loaded = require("yaml")
  if (typeof loaded?.parse === "function") YAML = loaded
  else if (typeof loaded?.default?.parse === "function") YAML = loaded.default
} catch {
  YAML = null
}

const DEFAULT_NAME = "config"

/** 去掉行尾注释，忽略引号内的 # */
function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === "\\") i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

function parseScalar(raw) {
  const value = raw.trim()
  if (!value) return ""
  if (/^"(?:[^"\\]|\\.)*"$/.test(value)) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }
  if (/^'(?:[^']|'')*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'")
  if (/^(true|yes|on)$/i.test(value)) return true
  if (/^(false|no|off)$/i.test(value)) return false
  if (/^(null|~)$/i.test(value)) return null
  if (/^-?\d+$/.test(value)) return Number(value)
  if (/^-?\d*\.\d+$/.test(value)) return Number(value)
  if (/^\[.*\]$/.test(value)) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(",").map((item) => parseScalar(item))
  }
  return value
}

/** 内置兜底解析器：只支持本插件配置用到的扁平 key: value */
function parseFlatYaml(text) {
  const result = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()
    if (!line || line.startsWith("-")) continue
    const idx = line.indexOf(":")
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    if (!key || key.includes(" ")) continue
    result[key] = parseScalar(line.slice(idx + 1))
  }
  return result
}

function parseYaml(text) {
  if (YAML?.parse) {
    try {
      return YAML.parse(text) || {}
    } catch (err) {
      throw new Error(`配置文件格式错误：${err.message}`)
    }
  }
  return parseFlatYaml(text)
}

export default class Config {
  /** 插件根目录绝对路径 */
  static get dir() {
    return pluginDir
  }

  static get runtimeDir() {
    return path.join(pluginDir, "config", "config")
  }

  static get defaultDir() {
    return path.join(pluginDir, "config", "default_config")
  }

  static runtimeFile(name) {
    return path.join(this.runtimeDir, `${name}.yaml`)
  }

  static defaultFile(name) {
    return path.join(this.defaultDir, `${name}.yaml`)
  }

  /** 读取配置：默认配置 + 用户配置合并，运行期缺失时自动复制默认配置 */
  static getConfig(name = DEFAULT_NAME) {
    const config = { ...this.getRawConfig(name), ...this.getEnvConfig() }
    return name === DEFAULT_NAME ? this.resolveBuiltinApi(config) : config
  }

  static getRawConfig(name = DEFAULT_NAME) {
    this.copyDefault(name)
    const defaults = this.readFile(this.defaultFile(name))
    const user = this.readFile(this.runtimeFile(name))
    const settings = name === DEFAULT_NAME ? this.getSettings() : {}
    return { ...defaults, ...user, ...settings }
  }

  static isBuiltinApi(value) {
    return ["builtin", "local", "auto", "内置"].includes(String(value || "").trim().toLowerCase())
  }

  static getBuiltinService() {
    const file = path.join(pluginDir, "runtime", "service.json")
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"))
      return value && typeof value === "object" && !Array.isArray(value) ? value : {}
    } catch {
      return {}
    }
  }

  static resolveBuiltinApi(config) {
    if (!this.isBuiltinApi(config.apiServer)) return { ...config, apiBuiltin: false }
    const service = this.getBuiltinService()
    const readyFile = path.join(pluginDir, "runtime", "ready.json")
    if (!fs.existsSync(readyFile) || !service.apiKey) {
      return { ...config, apiBuiltin: true, apiServer: "", apiReady: false }
    }
    const port = Number(service.port) || Number(config.managedPort) || 18780
    return {
      ...config,
      apiBuiltin: true,
      apiReady: true,
      apiServer: `http://127.0.0.1:${port}`,
      apiKey: config.apiKey || service.apiKey || "",
      sessionToken: config.sessionToken || service.sessionToken || ""
    }
  }

  static getEnvConfig() {
    const env = {}
    if (process.env.HONGGUO_API_URL) env.apiServer = String(process.env.HONGGUO_API_URL).trim()
    if (process.env.HONGGUO_API_KEY) env.apiKey = String(process.env.HONGGUO_API_KEY).trim()
    if (process.env.HONGGUO_SESSION_TOKEN) env.sessionToken = String(process.env.HONGGUO_SESSION_TOKEN).trim()
    if (process.env.HONGGUO_SIGN_SERVER) env.externalSignServer = String(process.env.HONGGUO_SIGN_SERVER).trim()
    if (process.env.HONGGUO_OFFLINE_API) {
      env.offlineApi = ["1", "true", "yes", "on"].includes(String(process.env.HONGGUO_OFFLINE_API).toLowerCase())
    }
    if (process.env.HONGGUO_DEVICE_POOL_SIZE) env.devicePoolSize = Number(process.env.HONGGUO_DEVICE_POOL_SIZE)
    if (process.env.HONGGUO_API_REQUIRED) {
      env.apiRequired = ["1", "true", "yes", "on"].includes(String(process.env.HONGGUO_API_REQUIRED).toLowerCase())
    }
    return env
  }

  static getSettings() {
    const file = path.join(this.runtimeDir, "settings.json")
    if (!fs.existsSync(file)) return {}
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"))
      if (!value || Array.isArray(value) || typeof value !== "object") throw new Error()
      return value
    } catch {
      throw new Error("红果命令配置 settings.json 损坏，请检查后重试")
    }
  }

  static updateSettings(patch) {
    const data = { ...this.getSettings(), ...patch }
    fs.mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 })
    fs.chmodSync(this.runtimeDir, 0o700)
    const target = path.join(this.runtimeDir, "settings.json")
    const temporary = `${target}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, target)
    return data
  }

  static setConfig(name = DEFAULT_NAME, data = {}) {
    fs.mkdirSync(this.runtimeDir, { recursive: true })
    const text = YAML?.stringify
      ? YAML.stringify(data)
      : Object.entries(data)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
    fs.writeFileSync(this.runtimeFile(name), text, "utf8")
    return data
  }

  /** 恢复为默认配置 */
  static reset(name = DEFAULT_NAME) {
    const src = this.defaultFile(name)
    if (!fs.existsSync(src)) return false
    fs.mkdirSync(this.runtimeDir, { recursive: true })
    fs.copyFileSync(src, this.runtimeFile(name))
    return true
  }

  static readFile(file) {
    try {
      if (!fs.existsSync(file)) return {}
      const data = parseYaml(fs.readFileSync(file, "utf8"))
      return data && typeof data === "object" ? data : {}
    } catch (err) {
      globalThis.logger?.error?.(`[红果短剧] 读取配置失败 ${file}: ${err.message}`)
      return {}
    }
  }

  static copyDefault(name = DEFAULT_NAME) {
    try {
      const src = this.defaultFile(name)
      const dst = this.runtimeFile(name)
      if (!fs.existsSync(src) || fs.existsSync(dst)) return
      fs.mkdirSync(this.runtimeDir, { recursive: true })
      fs.copyFileSync(src, dst)
    } catch (err) {
      globalThis.logger?.warn?.(`[红果短剧] 写入默认配置失败: ${err.message}`)
    }
  }
}
