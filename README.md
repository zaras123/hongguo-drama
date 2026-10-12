# 红果短剧 / 漫剧云崽插件

在云崽聊天中发送红果分享链接，解析剧集、下载指定集并发送视频。
这是目录式插件，需要部署整个目录，不是独立的单文件 JS。

[部署与登录](DEPLOY.md) | [测试与验收](VERIFY.md) | [维护与修复记录](HANDOVER.md)

## 能力与边界

- 官方短剧、漫剧短链及 App scheme 解析，默认自动下载分享集。
- 剧名搜索、选集、下载限额、重试、官网回退和临时文件清理。
- 视频发送、文件回退、可选 H.264/AAC 转码及 base64 远程视频传输。
- 主人私聊管理上游安装、ADB 设备、App 安装、Frida 准备、服务启停和会话同步。

**登录必须在设备 App 内人工完成**，插件没有独立短信或扫码登录接口，不代收手机号、验证码。
没有设备时可以使用官网当前开放内容。部署服务不保证全集可下，不提供广告或付费解锁。

## 快速开始

Bot 主机需要 Node.js 20.19+ 或 22.12+，以及 FFmpeg 套件中的 **ffprobe**。
每次下载都验证 MP4 容器和视频轨道，缺少 ffprobe 会明确失败。
原生 icqq 视频上传还需要协议端可用的 ffmpeg；转码需要包含 libx264 的 ffmpeg。
插件 JS 无额外 npm 依赖。

将完整仓库放入云崽 `plugins/hongguo-drama` 后重启。
私有仓库先在部署机完成 `gh auth login`，再在云崽根目录执行：

~~~bash
gh repo clone zaras123/hongguo-drama plugins/hongguo-drama
~~~

工具不在 PATH 时，主人私聊设置：

~~~text
#红果设置 FFprobe /绝对路径/ffprobe
#红果设置 FFmpeg /绝对路径/ffmpeg
~~~

随后发送分享链接，或 `#红果搜索 剧名`。App 数据源的额外环境见 [DEPLOY.md](DEPLOY.md)。
官网路线不需要 Python、安卓设备或登录。不要把 GitHub 令牌写入克隆地址或聊天消息。

## 命令

| 命令 | 行为 |
| --- | --- |
| 直接发送官方分享链接 | 解析后自动下载分享集 |
| `#红果解析 <链接或ID>` | 只返回剧集信息，并缓存供后续选集 |
| `#红果下载 <链接> 1-3` | 解析后下载明确指定的集数 |
| `#红果下载 2` | 当前 Bot、群/私聊和用户上次解析的第 2 集 |
| `#红果下载 全部` | 仍受单次集数上限约束，默认最多 3 集 |
| `#红果搜索 剧名` / `#红果帮助` | 搜索 / 日常命令 |
| `#红果管理` / `#红果设置` | 主人私聊管理入口 / 设置列表 |
| `#红果安装` | 安装或修复固定版本上游，保留账号配置 |
| `#红果设备` / `#红果连接 地址:端口` | 列出或连接设备 |
| `#红果设置 设备 序列号` | 选择设备 |
| `#红果安装App APK绝对路径` | 安装 Bot 主机上的 APK |
| `#红果准备设备` | 为已有 root 的设备准备 Frida |
| `#红果启动` / `#红果停止` / `#红果状态` | 管理插件拥有的本机 Python 服务 |
| `#红果登录` | 打开 App，之后在 App 内人工登录 |
| `#红果登录完成` / `#红果同步登录` | 同步 App 会话到 API |
| `#红果登录状态` | 凭证、设备参数、签名状态；不验证账号身份 |
| `#红果重载` | 主人重读配置 |

选集支持 `1`、`1-3,5`、`第2集`、`1，2、4`、`全部`。
明确指定的集数失败时不会替换内容。自动分享集模式下，漫剧若已回退官网且分享集超出开放范围，
会提示并改下第 1 集；仅配置过 API 地址不会阻止此降级。

## 功能流程

~~~text
分享消息 -> 官方域名检查 -> 受限短链跳转 -> 分集与当前集解析
        -> API / 官网数据源 -> 会话缓存 -> 选集与并发限制
        -> 实时取链 -> 下载 .part -> 响应范围/长度/ffprobe 检查
        -> MP4 成品 -> 可选转码 -> 视频发送 -> 失败尝试文件
        -> 清理临时文件、释放任务
~~~

API 分集/搜索失败会回退官网。API 流下载失败会尝试官网同集，即使整集重试设为 0。
漫剧分享页的短预览不作为正片。平台开放范围和账号权限以实际返回为准。

## 配置

首次运行生成 `config/config/config.yaml`。命令设置写入 `config/config/settings.json`，优先于 YAML。
命令设置即时生效；手改 YAML 后发 `#红果重载`。已被命令覆盖的值应继续用命令修改。

| 配置 | 默认 | 含义 |
| --- | --- | --- |
| enableAutoParse / autoDownload | true / true | 自动识别 / 自动下载 |
| autoDownloadRange | shared | 分享集，可设 first、1-3、全部 |
| maxEpisodesPerRequest | 3 | 每次集数上限 |
| maxConcurrentParses / maxConcurrentDownloads | 4 / 2 | 全插件解析 / 下载并发上限，满时提示重试 |
| maxFileSizeMB | 100 | 文件 MB 上限；0 关闭上限，不建议公开群这样设置 |
| requestTimeout / maxPageSizeMB | 30000 / 4 | 单次页面完整时限（毫秒）/ 解压后 MB 上限 |
| downloadTimeout / downloadIdleTimeout | 600000 / 60000 | 单次下载总时限 / 停滞时限（毫秒） |
| downloadRetries / episodeRetries | 2 / 2 | 下载重试 / 重新取链重试，支持 0 |
| sendType | video | video 或 file |
| videoTransport / maxBase64SizeMB | file / 30 | 原始绝对路径或 base64 / 原文件 MB 上限 |
| cleanupAfterSend | true | 发送尝试结束后清理，包括发送失败 |
| transcodeVideo | false | 转 H.264/AAC，不省略下载阶段 ffprobe 校验 |
| ffprobePath / ffmpegPath | ffprobe / ffmpeg | 可执行文件路径 |
| sessionTTL | 1800 | 缓存有效秒数 |
| apiServer / apiKey / sessionToken | 空 | API 根地址 / 下载 Key / 独立登录管理 Key |

其余配置见 `config/default_config/config.yaml`。例如：

~~~text
#红果设置 自动下载 关
#红果设置 选集 shared
#红果设置 发送方式 文件
#红果设置 传输 base64
#红果设置 转码 开
~~~

## 安全与兼容

- HTTP 分享只允许代码白名单中的官方主机，域名出现在路径、fragment 或用户名中不算合法。
- 逐跳检查地址，拒绝 URL 凭据、异常端口、私网和回环；DNS 结果固定到实际连接，防止重绑定。
- CDN 下载同样禁止私网目标。主人配置的 API 是单独信任边界，可以位于私网；带密钥流禁止重定向。
- 主人自定义 siteOrigin 表示信任该源；普通用户分享不会获得此例外。
- 拒收文本、不完整 206、空文件、断流和无视频轨道的文件。ffprobe 不等于逐帧解码或 DRM 解锁。
- 原生 icqq 用原始路径及 `group.fs.upload(file, "/", name)`；只有 sendFile 的包装接口用二参数约定。
- 远程协议端没有共享磁盘时用 base64；文件回退仍要求适配器能读 Bot 文件。QQ 限制无法由插件保证。
- App 数据源使用固定版本 [zhangbaio/hongguo](https://github.com/zhangbaio/hongguo)。

实机验收边界见 [VERIFY.md](VERIFY.md)。只下载有权访问的内容，并遵守服务条款。
