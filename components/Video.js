import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"

const run = promisify(execFile)

export async function prepareVideo(filePath, config) {
  if (!config.transcodeVideo) return filePath
  const options = { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 }
  let streams
  try {
    const { stdout } = await run(config.ffprobePath || "ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt", "-of", "json", filePath
    ], options)
    streams = JSON.parse(stdout).streams || []
  } catch {
    throw new Error("视频检查失败，请确认 ffprobe 已安装且能读取视频")
  }
  const video = streams.find((stream) => stream.codec_type === "video")
  if (!video) throw new Error("下载结果没有视频轨道")
  if (video.codec_name === "h264" && video.pix_fmt === "yuv420p" &&
      streams.filter((s) => s.codec_type === "audio").every((s) => s.codec_name === "aac")) return filePath

  const target = `${filePath}.qq.mp4`
  try {
    await run(config.ffmpegPath || "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", filePath,
      "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "fast",
      "-crf", "23", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", target
    ], { ...options, timeout: Number(config.transcodeTimeout) || 600000 })
    const stat = await fs.stat(target)
    if (!stat.size) throw new Error("empty")
    if (Number(config.maxFileSizeMB) > 0 && stat.size > config.maxFileSizeMB * 1048576) {
      throw new Error("size limit")
    }
    return target
  } catch {
    await fs.rm(target, { force: true }).catch(() => {})
    throw new Error("视频转码失败、超时或超出体积限制，请检查 ffmpeg 的 libx264 支持和 maxFileSizeMB")
  }
}

export function assertSent(result) {
  if (result === false || result === null || result?.status === "failed" ||
      (typeof result?.retcode === "number" && result.retcode !== 0)) {
    throw new Error("消息适配器返回发送失败")
  }
}
