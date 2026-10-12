export default class SessionAPI {
  constructor(config) {
    this.config = config
  }

  async request(action = "") {
    const { apiServer, sessionToken } = this.config
    if (!apiServer || !sessionToken) throw new Error("请先私聊发送 #红果管理，完成安装和启动；已有远程服务可通过 #红果设置 配置地址和登录密钥")
    if (!["", "start", "sync"].includes(action)) throw new Error("无效的登录操作")
    const base = new URL(apiServer)
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error("apiServer 必须是不含凭据和查询参数的 HTTP(S) 根地址")
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 65000)
    try {
      const response = await fetch(`${String(apiServer).replace(/\/+$/, "")}/admin/session${action ? `/${action}` : ""}`, {
        method: action ? "POST" : "GET",
        headers: { "X-Session-Token": sessionToken, Accept: "application/json" },
        redirect: "error", signal: controller.signal
      })
      if (response.status === 401) throw new Error("登录管理鉴权失败，请检查 sessionToken")
      if (response.status === 404) throw new Error("服务端没有登录管理接口，请用 run_bridge.py 启动")
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        // The bridge emits fixed diagnostics, never raw upstream exception text.
        const detail = String(payload.detail || "").replaceAll(String(sessionToken), "[redacted]").slice(0, 250)
        throw new Error(`登录管理接口 HTTP ${response.status}${detail ? `：${detail}` : ""}`)
      }
      return await response.json()
    } catch (err) {
      if (controller.signal.aborted) throw new Error("登录操作超时，请检查设备和签名服务状态后重试")
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}
