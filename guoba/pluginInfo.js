import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const pkg = require("../package.json")

export default {
  name: "hongguo-drama",
  title: "红果短剧 / 漫剧",
  description: "解析红果分享链接、下载剧集并发送视频",
  author: "zaras123",
  version: pkg.version,
  repo: "https://github.com/zaras123/hongguo-drama",
  icon: "mdi:movie-open",
  depends: []
}
