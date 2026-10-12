import http from "node:http"
import https from "node:https"
import dns from "node:dns/promises"
import net from "node:net"
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib"

export const SHARE_HOSTS = new Set([
  "hongguoduanju.com", "www.hongguoduanju.com", "applink.novelquickapp.com",
  "kylin.hainanyuyue.com", "hainanyuyue.com", "www.hainanyuyue.com"
])
const specialIPv6 = new net.BlockList()
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]) {
  specialIPv6.addSubnet(address, prefix, "ipv6")
}

export function shareUrl(value) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
      !SHARE_HOSTS.has(url.hostname)) throw new Error("仅支持官方分享域名及标准 HTTP(S) 端口")
  return url
}

export function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113))
  }
  // Only global unicast IPv6; exclude transition and documentation ranges.
  if (!net.isIPv6(address)) return false
  const normalized = new URL("http://[" + address + "]").hostname.slice(1, -1)
  return /^[23][0-9a-f]{3}:/.test(normalized) &&
    !specialIPv6.check(normalized, "ipv6")
}

function abortable(promise, signal) {
  signal?.throwIfAborted()
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

// Resolve once and pin the verified address to the socket, preserving Host and TLS SNI.
export async function openResponse(value, options = {}, dependencies = {}) {
  const url = new URL(value)
  const trusted = options.trustedOrigin && url.origin === options.trustedOrigin
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (!trusted && url.port)) {
    throw new Error("请求地址或端口不受支持")
  }
  if (options.share) shareUrl(url)
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  let records
  if (!trusted) {
    records = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] :
      await abortable((dependencies.lookup || dns.lookup)(hostname, { all: true, verbatim: true }), options.signal)
    if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
      throw new Error("禁止访问本机、内网或保留网络地址")
    }
  }
  options.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const request = dependencies.request || (url.protocol === "https:" ? https.request : http.request)
    const req = request(url, {
      headers: { ...options.headers, "Accept-Encoding": "identity" },
      signal: options.signal, agent: false,
      ...(records ? { lookup: (_host, opts, callback) => {
        const record = records.find((item) => item.family === 4) || records[0]
        if (opts.all) callback(null, [record])
        else callback(null, record.address, record.family)
      } } : {})
    }, (response) => resolve({
      status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300,
      headers: new Headers(Object.entries(response.headers).filter(([, v]) => v !== undefined)
        .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value])),
      body: response, url: url.href
    }))
    req.once("error", reject)
    req.end()
  })
}

export async function followResponse(value, options = {}) {
  let url = new URL(value)
  for (let hop = 0; hop <= 5; hop++) {
    const response = await openResponse(url, options)
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    response.body.destroy()
    if (options.noRedirect) throw new Error("服务接口不允许重定向")
    const location = response.headers.get("location")
    if (!location || hop === 5) throw new Error("页面重定向无效或次数过多")
    url = new URL(location, url)
    if (options.share) shareUrl(url)
  }
}

export async function readText(response, maxBytes) {
  let stream = response.body
  const encoding = response.headers.get("content-encoding")?.toLowerCase()
  const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() :
    encoding === "br" ? createBrotliDecompress() : null
  if (encoding && encoding !== "identity" && !decoder) throw new Error("不支持的页面压缩格式")
  if (decoder) {
    stream.on("error", (error) => decoder.destroy(error))
    stream = stream.pipe(decoder)
  }
  try {
    const chunks = []
    let size = 0
    for await (const chunk of stream) {
      size += chunk.length
      if (size > maxBytes) throw new Error("页面超过大小限制")
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString("utf8")
  } finally {
    stream.destroy()
    response.body.destroy()
  }
}
