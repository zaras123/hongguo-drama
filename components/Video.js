import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"

const run = promisify(execFile)
const VIDEO_SAMPLE_TYPES = new Set(["avc1", "avc3", "hvc1", "hev1", "vp09", "av01", "mp4v"])
const CONTAINER_TYPES = new Set(["moov", "trak", "mdia", "minf", "stbl"])

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buffer, 0, length, position)
  return buffer.subarray(0, bytesRead)
}

function parseBoxHeader(buffer, remaining) {
  if (buffer.length < 8) return null
  let size = buffer.readUInt32BE(0)
  const type = buffer.subarray(4, 8).toString("latin1")
  let headerSize = 8
  if (size === 1) {
    if (buffer.length < 16) return null
    const large = buffer.readBigUInt64BE(8)
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null
    size = Number(large)
    headerSize = 16
  } else if (size === 0) {
    size = remaining
  }
  if (!type || size < headerSize) return null
  return { size, type, headerSize }
}

async function scanSampleDescriptions(handle, start, end, state) {
  const header = await readAt(handle, start, 8)
  if (header.length < 8) return
  const count = header.readUInt32BE(4)
  let offset = start + 8
  for (let index = 0; index < count && offset + 8 <= end; index++) {
    const box = parseBoxHeader(await readAt(handle, offset, 16), end - offset)
    if (!box || box.type === "stsd" || box.size > end - offset) return
    if (VIDEO_SAMPLE_TYPES.has(box.type)) state.video = true
    if (box.type === "encv") state.encrypted = true
    offset += box.size
  }
}

async function scanBoxes(handle, fileSize, start, end, state, depth = 0) {
  if (depth > 8) return
  let offset = start
  while (offset + 8 <= end) {
    const box = parseBoxHeader(await readAt(handle, offset, 16), end - offset)
    if (!box || box.size > end - offset) throw new Error("MP4 box 结构无效")
    if (box.type === "ftyp") state.ftyp = true
    else if (box.type === "moov") state.moov = true
    else if (box.type === "mdat") state.mdat = true

    const contentStart = offset + box.headerSize
    const contentEnd = offset + box.size
    if (box.type === "stsd") await scanSampleDescriptions(handle, contentStart, contentEnd, state)
    else if (CONTAINER_TYPES.has(box.type)) {
      await scanBoxes(handle, fileSize, contentStart, contentEnd, state, depth + 1)
    }
    offset += box.size
  }
}

/** ffprobe 不可用时的基础 MP4 结构检查。 */
export async function validateMp4Structure(filePath) {
  const handle = await fs.open(filePath, "r")
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 32) throw new Error("file too small")
    const state = { ftyp: false, moov: false, mdat: false, video: false, encrypted: false }
    await scanBoxes(handle, stat.size, 0, stat.size, state)
    if (!state.ftyp || !state.moov || !state.mdat || !state.video || state.encrypted) {
      throw new Error("not a complete plain MP4 video")
    }
    return [{ codec_type: "video", codec_name: "unknown", pix_fmt: "" }]
  } finally {
    await handle.close()
  }
}

export async function validateVideo(filePath, config = {}) {
  const options = { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 }
  let streams
  try {
    const { stdout } = await run(config.ffprobePath || "ffprobe", [
      "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
      "stream=codec_type,codec_name,pix_fmt:format=format_name", "-of", "json", filePath
    ], options)
    const info = JSON.parse(stdout)
    if (!String(info.format?.format_name).split(",").includes("mp4")) throw new Error("not MP4")
    streams = info.streams || []
  } catch (probeError) {
    try {
      streams = await validateMp4Structure(filePath)
    } catch {
      throw new Error("视频检查失败，ffprobe 和内置 MP4 检查都无法读取视频")
    }
  }
  const video = streams.find((stream) => stream.codec_type === "video")
  if (!video) throw new Error("下载结果没有视频轨道")
  return streams
}

export async function prepareVideo(filePath, config) {
  if (!config.transcodeVideo) return filePath
  const streams = await validateVideo(filePath, config)
  const video = streams.find((stream) => stream.codec_type === "video")
  const options = { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 }
  if (video.codec_name === "h264" && video.pix_fmt === "yuv420p" &&
      streams.filter((s) => s.codec_type === "audio").every((s) => s.codec_name === "aac")) return filePath

  const target = `${filePath}.qq.mp4`
  try {
    await run(config.ffmpegPath || "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-protocol_whitelist", "file,pipe", "-i", filePath,
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
