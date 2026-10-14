import Config from "../../components/Config.js"

const fields = {
  basic: [
    "enableAutoParse",
    "autoDownload",
    "autoDownloadRange",
    "maxEpisodesPerRequest",
    "maxConcurrentParses",
    "maxConcurrentDownloads",
    "maxFileSizeMB",
    "sessionTTL",
    "tempDir"
  ],
  api: [
    "apiServer",
    "apiKey",
    "sessionToken",
    "useApiServer",
    "preferApiServer",
    "apiRequired",
    "apiAutoSetup",
    "apiAutoStart",
    "offlineApi",
    "externalSignServer",
    "devicePoolSize",
    "streamQuality",
    "apiServerTimeout",
    "apiServerIdleTimeout"
  ],
  send: [
    "sendType",
    "videoTransport",
    "maxBase64SizeMB",
    "cleanupAfterSend",
    "transcodeVideo",
    "ffmpegPath",
    "ffprobePath",
    "transcodeTimeout"
  ],
  managed: [
    "pythonPath",
    "adbPath",
    "adbDevice",
    "managedPort",
    "managedSignPort",
    "fridaHost",
    "fridaBin"
  ]
}

const booleans = new Set([
  "enableAutoParse",
  "autoDownload",
  "useApiServer",
  "preferApiServer",
  "apiRequired",
  "apiAutoSetup",
  "apiAutoStart",
  "offlineApi",
  "cleanupAfterSend",
  "transcodeVideo"
])

const numbers = new Set([
  "maxEpisodesPerRequest",
  "maxConcurrentParses",
  "maxConcurrentDownloads",
  "maxFileSizeMB",
  "sessionTTL",
  "devicePoolSize",
  "apiServerTimeout",
  "apiServerIdleTimeout",
  "maxBase64SizeMB",
  "transcodeTimeout",
  "managedPort",
  "managedSignPort"
])

function normalizeValue(key, value) {
  if (booleans.has(key)) return Boolean(value)
  if (numbers.has(key)) {
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) throw new Error(`${key} 必须是非负数字`)
    return number
  }
  const text = String(value ?? "").trim()
  if (!text) return ""
  if (["apiServer", "externalSignServer"].includes(key)) {
    if (["关闭", "off", "none", "false"].includes(text.toLowerCase())) return ""
    if (key === "apiServer" && ["内置", "builtin", "local", "auto"].includes(text.toLowerCase())) return "builtin"
    const url = new URL(text)
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error(`${key} 必须是不含凭据和查询参数的 HTTP(S) 地址`)
    }
    return url.href.replace(/\/+$/, "")
  }
  return text
}

function sectionData(raw, section) {
  const output = {}
  for (const key of fields[section]) output[key] = raw[key]
  return output
}

export const schemas = [
  {
    component: "Divider",
    label: "基础功能"
  },
  {
    field: "basic.enableAutoParse",
    label: "自动解析分享链接",
    component: "Switch",
    defaultValue: true
  },
  {
    field: "basic.autoDownload",
    label: "自动下载分享集",
    component: "Switch",
    defaultValue: true
  },
  {
    field: "basic.autoDownloadRange",
    label: "自动选集",
    component: "Select",
    options: [
      { label: "分享集", value: "shared" },
      { label: "第 1 集", value: "first" },
      { label: "全部", value: "all" }
    ],
    defaultValue: "shared"
  },
  {
    field: "basic.maxEpisodesPerRequest",
    label: "单次最多下载集数",
    component: "InputNumber",
    min: 1,
    max: 100,
    defaultValue: 3
  },
  {
    field: "basic.maxConcurrentParses",
    label: "解析并发上限",
    component: "InputNumber",
    min: 1,
    max: 100,
    defaultValue: 4
  },
  {
    field: "basic.maxConcurrentDownloads",
    label: "下载并发上限",
    component: "InputNumber",
    min: 1,
    max: 100,
    defaultValue: 2
  },
  {
    field: "basic.maxFileSizeMB",
    label: "单文件大小上限 MB",
    component: "InputNumber",
    min: 0,
    max: 4096,
    defaultValue: 100
  },
  {
    field: "basic.sessionTTL",
    label: "解析缓存秒数",
    component: "InputNumber",
    min: 0,
    max: 86400,
    defaultValue: 1800
  },
  {
    field: "basic.tempDir",
    label: "临时目录",
    component: "Input",
    placeholder: "./temp"
  },
  {
    component: "Divider",
    label: "API"
  },
  {
    component: "Alert",
    message: "Linux 建议使用中心 API；游客离线模式需要外部 unidbg 签名服务。",
    type: "info"
  },
  {
    field: "api.apiServer",
    label: "服务地址",
    component: "Input",
    placeholder: "builtin / https://api.example.com / 关闭"
  },
  {
    field: "api.apiKey",
    label: "下载 Key",
    component: "Input",
    placeholder: "远程 API 下载密钥"
  },
  {
    field: "api.sessionToken",
    label: "登录管理 Key",
    component: "Input",
    placeholder: "远程 API 登录管理密钥"
  },
  {
    field: "api.useApiServer",
    label: "启用 API",
    component: "Switch",
    defaultValue: true
  },
  {
    field: "api.preferApiServer",
    label: "优先使用 API",
    component: "Switch",
    defaultValue: true
  },
  {
    field: "api.apiRequired",
    label: "API 必需，不回落官网",
    component: "Switch",
    defaultValue: false
  },
  {
    field: "api.apiAutoSetup",
    label: "自动安装内置 API",
    component: "Switch",
    defaultValue: true
  },
  {
    field: "api.apiAutoStart",
    label: "设备就绪后自动启动",
    component: "Switch",
    defaultValue: true
  },
  {
    field: "api.offlineApi",
    label: "游客离线 API",
    component: "Switch",
    defaultValue: true
  },
  {
    field: "api.externalSignServer",
    label: "unidbg 签名服务",
    component: "Input",
    placeholder: "http://127.0.0.1:9099"
  },
  {
    field: "api.devicePoolSize",
    label: "游客设备池数量",
    component: "InputNumber",
    min: 0,
    max: 1000,
    defaultValue: 20
  },
  {
    field: "api.streamQuality",
    label: "清晰度",
    component: "Select",
    options: ["best", "1080p", "720p", "540p", "480p", "360p"].map((value) => ({ label: value, value })),
    defaultValue: "best"
  },
  {
    field: "api.apiServerTimeout",
    label: "API 超时毫秒",
    component: "InputNumber",
    min: 1000,
    max: 600000,
    defaultValue: 180000
  },
  {
    field: "api.apiServerIdleTimeout",
    label: "API 空闲超时毫秒",
    component: "InputNumber",
    min: 1000,
    max: 600000,
    defaultValue: 300000
  },
  {
    component: "Divider",
    label: "发送与转码"
  },
  {
    field: "send.sendType",
    label: "发送方式",
    component: "Select",
    options: [
      { label: "视频", value: "video" },
      { label: "文件", value: "file" }
    ],
    defaultValue: "video"
  },
  {
    field: "send.videoTransport",
    label: "视频传输",
    component: "Select",
    options: [
      { label: "文件路径", value: "file" },
      { label: "base64", value: "base64" }
    ],
    defaultValue: "file"
  },
  {
    field: "send.maxBase64SizeMB",
    label: "base64 原文件上限 MB",
    component: "InputNumber",
    min: 1,
    max: 200,
    defaultValue: 30
  },
  {
    field: "send.cleanupAfterSend",
    label: "发送后清理",
    component: "Switch",
    defaultValue: true
  },
  {
    field: "send.transcodeVideo",
    label: "转 H.264/AAC",
    component: "Switch",
    defaultValue: false
  },
  {
    field: "send.ffmpegPath",
    label: "FFmpeg 路径",
    component: "Input",
    placeholder: "ffmpeg"
  },
  {
    field: "send.ffprobePath",
    label: "FFprobe 路径",
    component: "Input",
    placeholder: "ffprobe"
  },
  {
    field: "send.transcodeTimeout",
    label: "转码超时毫秒",
    component: "InputNumber",
    min: 1000,
    max: 3600000,
    defaultValue: 600000
  },
  {
    component: "Divider",
    label: "托管与设备"
  },
  {
    field: "managed.pythonPath",
    label: "Python",
    component: "Input",
    placeholder: "python"
  },
  {
    field: "managed.adbPath",
    label: "ADB",
    component: "Input",
    placeholder: "adb"
  },
  {
    field: "managed.adbDevice",
    label: "设备序列号",
    component: "Input",
    placeholder: "emulator-5554"
  },
  {
    field: "managed.managedPort",
    label: "API 端口",
    component: "InputNumber",
    min: 1024,
    max: 65535,
    defaultValue: 18780
  },
  {
    field: "managed.managedSignPort",
    label: "签名端口",
    component: "InputNumber",
    min: 1024,
    max: 65535,
    defaultValue: 18781
  },
  {
    field: "managed.fridaHost",
    label: "Frida 地址",
    component: "Input",
    placeholder: "127.0.0.1:27042"
  },
  {
    field: "managed.fridaBin",
    label: "Frida Server 路径",
    component: "Input",
    placeholder: "/data/local/tmp/frida-server"
  }
]

export function getConfigData() {
  const raw = Config.getRawConfig()
  return Object.fromEntries(Object.keys(fields).map((section) => [section, sectionData(raw, section)]))
}

export function setConfigData(data, { Result }) {
  const patch = {}
  for (const [section, keys] of Object.entries(fields)) {
    const values = data?.[section]
    if (!values || typeof values !== "object") continue
    for (const key of keys) {
      if (!Object.hasOwn(values, key)) continue
      patch[key] = normalizeValue(key, values[key])
    }
  }
  Config.updateSettings(patch)
  return Result.ok({}, "保存成功")
}
