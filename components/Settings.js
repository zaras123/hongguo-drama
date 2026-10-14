const names = {
  "Python": "pythonPath", "python": "pythonPath", "ADB": "adbPath", "adb": "adbPath",
  "设备": "adbDevice", "端口": "managedPort", "签名端口": "managedSignPort",
  "签名服务": "externalSignServer", "服务地址": "apiServer", "下载密钥": "apiKey",
  "登录密钥": "sessionToken", "清晰度": "streamQuality", "自动下载": "autoDownload",
  "自动解析": "enableAutoParse", "选集": "autoDownloadRange", "每次集数": "maxEpisodesPerRequest",
  "大小上限": "maxFileSizeMB", "发送方式": "sendType", "传输": "videoTransport",
  "转码": "transcodeVideo", "FFmpeg": "ffmpegPath", "ffmpeg": "ffmpegPath",
  "FFprobe": "ffprobePath", "ffprobe": "ffprobePath",
  "API自动安装": "apiAutoSetup", "API自动启动": "apiAutoStart", "API必需": "apiRequired"
}
const booleans = new Set(["autoDownload", "enableAutoParse", "transcodeVideo", "apiAutoSetup", "apiAutoStart", "apiRequired"])
const enums = {
  streamQuality: ["best", "1080p", "720p", "540p", "480p", "360p"],
  sendType: ["video", "file"], videoTransport: ["file", "base64"]
}

export function parseSetting(text) {
  const match = String(text).trim().match(/^(\S+)\s+([\s\S]+)$/)
  if (!match || !Object.hasOwn(names, match[1])) throw new Error("设置写法：#红果设置 设备 emulator-5554；发送 #红果设置 查看可设置项")
  const key = names[match[1]]
  let value = match[2].trim().replace(/^"([\s\S]*)"$/, "$1")
  if (!value || value.length > 1000 || /[\r\n\0]/.test(value)) throw new Error("设置值无效")
  if (booleans.has(key)) {
    if (["开", "开启", "true"].includes(value)) value = true
    else if (["关", "关闭", "false"].includes(value)) value = false
    else throw new Error("请填写 开 或 关")
  } else if (["managedPort", "managedSignPort", "maxEpisodesPerRequest", "maxFileSizeMB"].includes(key)) {
    const max = key.startsWith("managed") ? 65535 : key === "maxEpisodesPerRequest" ? 100 : 4096
    const min = key === "maxFileSizeMB" ? 0 : key.startsWith("managed") ? 1024 : 1
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error("设置数值超出允许范围")
    value = Number(value)
  } else if (enums[key]) {
    value = ({ "视频": "video", "文件": "file", "最佳": "best" })[value] || value
    if (!enums[key].includes(value)) throw new Error("可选值：" + enums[key].join("、"))
  } else if (["apiServer", "externalSignServer"].includes(key)) {
    if (value === "关闭") value = ""
    else if (key === "apiServer" && ["内置", "builtin", "local", "auto"].includes(value.toLowerCase())) value = "builtin"
    else {
      const url = new URL(value)
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("服务地址必须是不含凭据和查询参数的 HTTP(S) 地址")
      }
      value = url.href.replace(/\/+$/, "")
    }
  } else if (key === "sessionToken" && value.length < 16) throw new Error("登录密钥至少 16 字符")
  else if (key === "autoDownloadRange" && !/^(shared|first|全部|all|\d+(?:-\d+)?(?:[,，、]\d+(?:-\d+)?)*)$/.test(value)) {
    throw new Error("选集可填 shared、first、1-3、全部")
  }
  return { key, value, secret: ["apiKey", "sessionToken"].includes(key) }
}

export const settingsHelp = [
  "#红果设置 <项目> <值>",
  "设备 / Python / ADB / 端口 / 签名端口 / 签名服务",
  "自动解析 开|关；自动下载 开|关；选集 shared|first|1-3",
  "清晰度 best|1080p|720p；每次集数 1-100；大小上限 MB",
  "发送方式 视频|文件；传输 file|base64；转码 开|关",
  "API自动安装 开|关；API自动启动 开|关；API必需 开|关",
  "FFmpeg / FFprobe 可执行文件路径",
  "API：服务地址 内置|http(s)地址|关闭",
  "已有远程服务：服务地址 / 下载密钥 / 登录密钥"
].join("\n")
