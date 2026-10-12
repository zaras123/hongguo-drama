# 红果短剧/漫剧解析下载插件（Yunzai-Bot）

文档入口：[部署指南](DEPLOY.md) · [验证记录](VERIFY.md) · [交付与后续验收](HANDOVER.md)。

完整部署与登录流程见 [DEPLOY.md](DEPLOY.md)。主人私聊发送 `#红果管理`，即可在插件内安装上游、
配置设备、启停服务、同步 App 会话及调整下载设置，无需手动启动两个 Python 终端。
真实登录在 App 中完成，插件不提供独立短信/扫码登录，也不代收手机号或验证码。
支持可选 H.264 转码、远程协议端 base64 视频发送，以及发送失败后文件回退。

逆向 `红果免费短剧`（`com.phoenix.read`，7.3.9.32）后写的云崽插件：识别红果短剧分享链接、
红果漫剧 `kylin.hainanyuyue.com` 分享链接、短链、scheme 和剧集 ID，解析整部剧的分集列表，
按集数下载视频并发到群里。群里直接发链接时，默认自动解析并下载分享链接指向的那一集。

插件不接入 `qsign.x406.cn`，没有将它当作红果签名接口。普通官网链路不需要签名；App 数据源使用
[zhangbaio/hongguo](https://github.com/zhangbaio/hongguo)，支持插件托管安装，也支持连接已有 API。

## 目录结构

```
hongguo-drama/
├── index.js                      # 插件入口：命令、会话缓存、选集、发送
├── components/
│   ├── Config.js                 # YAML 配置读写（缺配置自动复制默认值）
│   ├── HongguoAPI.js             # 解析/下载核心（官网 SSR + 可选自建 API 服务）
│   ├── ManjuAPI.js               # 漫剧分享页解析、video_id -> 官网 series_id 映射
│   ├── ManagedRuntime.js         # 安装、ADB、托管服务生命周期
│   ├── Settings.js               # 中文设置命令及校验
│   ├── SessionAPI.js             # 登录管理客户端
│   └── Video.js                  # 转码、视频发送结果检查
├── server/                      # 上游安装器、服务托管、登录桥接
├── tests/                       # 本地 HTTP 工作流与生命周期测试
└── config/default_config/
    └── config.yaml               # 默认配置
```

## 安装

1. 把整个 `hongguo-drama` 文件夹放到 Yunzai-Bot 的 `plugins/` 目录下：

```
Yunzai-Bot/
├── lib/
└── plugins/
    └── hongguo-drama/
        ├── index.js
        ├── components/
        └── config/
```

2. 重启 Bot（或重载插件）。首次运行会自动生成 `config/config/config.yaml`。
3. 插件使用 Node.js 20.19+ 或 22.12+，无需 npm install；有 yaml 包时使用它，没有则用内置解析器。仅使用官网开放内容不需要 Python 或设备。
4. 需要 App 数据源时，Bot 主机先安装 Python 3.10+、ADB 和 FFmpeg；准备一个已有 root 权限的安卓设备或模拟器。然后主人私聊操作：

~~~text
#红果安装
#红果设备
#红果设置 设备 emulator-5554
#红果安装App /绝对路径/base.apk
#红果准备设备
#红果启动
#红果登录
~~~

序列号、APK 路径按实际替换；App 已安装可跳过安装App。在设备 App 内完成登录和验证后，
发送 `#红果登录完成`，再发一条分享链接验收。没有设备时可先安装环境和使用官网开放集，
但不能完成 App 登录、动态签名与账号下载验收。模拟器安装、root 开启和验证码验证仍需人工操作。

## 命令

| 命令 | 说明 |
|---|---|
| 直接发链接 | 自动解析并下载分享链接指向的那一集（可在配置里关闭） |
| `#红果解析 <分享链接\|短链\|剧集ID>` | 解析并返回剧名、集数、题材、简介、封面 |
| `#红果下载 <链接> 1-3` | 下载指定集数并发送视频 |
| `#红果下载 2` | 下载上次解析剧集的第 2 集 |
| `#红果下载 全部` | 下载全集（受单次集数上限约束） |
| `#红果搜索 逆袭` | 按剧名搜索 |
| `#红果帮助` | 查看命令与当前配置 |
| `#红果管理` | 主人私聊：完整管理菜单 |
| `#红果安装` | 下载固定版本上游并创建插件专用 Python 环境 |
| `#红果设备` / `#红果连接 地址:端口` | 列出 ADB 设备，或连接并选中设备 |
| `#红果设置 设备 序列号` | 选择设备，运行服务时需先停止 |
| `#红果安装App APK绝对路径` | 将 Bot 主机的 APK 安装到所选设备 |
| `#红果准备设备` | 为已有 root 的设备准备匹配版本 Frida |
| `#红果启动` / `#红果停止` / `#红果状态` | 托管服务启停、进度和会话状态 |
| `#红果设置` | 查看可用设置项；设置命令立即生效 |
| `#红果登录` | 主人私聊：启动设备上的 App，在 App 内登录 |
| `#红果登录完成` / `#红果同步登录` | 主人私聊：同步 App 会话并更新服务端配置 |
| `#红果登录状态` | 主人私聊：查看凭证配置和签名服务状态 |
| `#红果重载` | 主人：重新读取配置 |

选集写法支持 `1`、`1-3`、`1-3,5`、`第2集`、`1，2、4`、`全部`。
默认每条命令最多下 3 集（`maxEpisodesPerRequest`），避免刷屏和风控。

群里直接发红果分享链接或 `applink.novelquickapp.com` 短链，插件会自动解析（可用 `enableAutoParse` 关闭）。
解析后会按 `autoDownloadRange` 自动下载；默认 `shared` 表示下载分享链接指向的那一集。
如果漫剧分享的是官网未开放的第 4 集及以后，且没有配置 `apiServer`，会自动改下第 1 集并提示原因。
自动识别同时覆盖 `dragon8662://`、`snssdk143://`、`snssdk2329://`、`sslocal://`、`douyinlite://`
以及带 `video_series_id` / `series_id` / `book_id` 参数的链接，漫剧额外覆盖
`kylin.hainanyuyue.com` 和 `hainanyuyue.com/share/video-animation-share`。

## 三条数据链路

### 1. 漫剧分享链接（kylin / hainanyuyue）

用户提供的示例短链：

```text
https://kylin.hainanyuyue.com/s/m9hyQxiK494/
```

请求后最终落到 `https://hainanyuyue.com/share/video-animation-share?...`。该页面是 SSR 页面，
`window._ROUTER_DATA` 里有剧名、封面、简介、题材、`chapter_ids` 全集列表和当前集信息。
示例解析结果：

| 字段 | 值 |
|---|---|
| 剧名 | `重生之绝世仙帝!` |
| 总集数 | `113` |
| 分享页当前集 | 第 `5` 集，`used_chapter_id=7671934603401120792` |
| `params.video_id` | `7671925985972866072` |
| 官网 `series_id` | 同 `params.video_id` |

插件用 `params.video_id` 到红果官网播放页校验：分享页 `chapter_ids` 与官网 `vid_list` 完全一致，
因此分集列表、前几集直链和下载流程都复用官网链路。若 `video_id` 失效，会再按剧名搜索官网兜底。

注意：分享页里的 `play_url` 是带 `start=0&end=30` 的 **30 秒预览**，去掉后返回 403，不能当作完整剧集。
示例中的官网播放页只开放前 3 集；第 4 集起需要配置自建 `apiServer`。

### 2. 官网解析（默认，开箱可用）

红果官网 `hongguoduanju.com` 的播放页是服务端渲染的，分集 `vid_list`、剧集信息和单集播放地址
都内嵌在 HTML 的 JSON 里，普通 GET 就能拿到：

| 用途 | 请求 | 取什么 |
|---|---|---|
| 剧集信息 | `GET /player/{series_id}` | `series_name`、`series_cover`、`series_intro`、`tags`、`vid_list`（按下标即集数） |
| 单集直链 | `GET /player/{series_id}/{vid}` | `contentUrl`（明文 MP4），兜底 `main_url` |
| 搜索 | `GET /search/{关键词}?page=1` | `searchList[]` |
| 详情兜底 | `GET /detail?series_id={sid}` | 播放页没数据时用 |

实测该直链是明文 MP4（`ftyp` 文件头、`video/mp4`、无 CENC 加密），可以直接下载播放，
不需要字节的 `x-gorgon` / `x-argus` 签名。

> App 私有接口（`/novel/player/multi_video_detail/preload/v1`、
> `/novel/player/multi_video_model/preload/v1` 等）在没有签名头时统一返回
> `HTTP 200` + `0 字节`，所以插件主链路不走它们。

### 3. 自建 API 服务（可选，解密后高清流）

如果你部署了 [zhangbaio/hongguo](https://github.com/zhangbaio/hongguo) 的 `server.py`
（Frida 签名后端 + spade 离线解密），在配置里填上地址即可优先使用它：

```yaml
apiServer: "http://127.0.0.1:8000"
apiKey: "服务端 /admin 生成的 api_key"
preferApiServer: true
streamQuality: "best"
```

插件会调用它的 `/episodes`、`/search`，下载时直接用 `/stream?vid=...&quality=...&api_key=...`
拿服务端解密好的可播 MP4（HEVC 1080p，支持 Range）。

自建服务报错、鉴权失败或不可达时，**会自动回退官网解析**，不会让命令直接失效。
下载时先试服务端流，失败立即尝试官网明文直链，即使 `episodeRetries: 0` 也会回退。
漫剧分享页解析成功后，优先通过服务端校验分集，无需官网页面同时可用。
`/play` 的 `encrypted_url` 是密文，插件不会把它当可播 MP4；`/download` 将文件保存在服务端，
因此 Bot 下载并发送视频使用的是 `/stream`。

### 上游服务准备

推荐使用 `#红果安装`、`#红果准备设备`、`#红果启动` 完成托管部署。插件会自动生成相互独立的
API Key、登录管理密钥和上游管理密钥，写入私有运行配置。默认 API 端口为 18780，签名端口为
18781，均只绑定本机。Bot 退出时回收所托管的 Python 进程；重启 Bot 后需再次 `#红果启动`。
停止服务不会停止设备上的 App 或 frida-server，也不会清除账号会话。

已有独立服务的用户也可手动部署，步骤见 DEPLOY.md：

按上游仓库部署完整 Python 项目和依赖。当前链路为 MuMu 或 redroid 中的 App + Frida，
连接 `sign_server.py:8001`，再由 `server.py:8000` 提供插件使用的接口。
设备、App 版本、`config.json` 的登录态及签名后端需要按上游文档配置；只启动 `server.py` 不够。
启动 API 前设置 `SIGN_SERVER=http://127.0.0.1:8001` 和自己的 `ADMIN_TOKEN`。
打开 API 的 `/admin`，用 `ADMIN_TOKEN` 创建普通 API Key，将生成的 Key 填进插件 `apiKey`。
数据接口强制校验普通 Key，管理口令不能代替它。

`apiServer` 必须填写 Bot 所在机器能访问的 API 根地址。Bot 与 API 不在同一机器或容器时，
`127.0.0.1` 不会指向另一台机器。仓库地址和签名服务的 8001 端口都不是 `apiServer`。
上游运行代码在首次安装时下载，不随插件包携带模拟器、APK、账号会话或 Python 二进制。

## 配置说明

`config/config/config.yaml`（首次运行从默认配置复制）：

| 配置 | 默认 | 说明 |
|---|---|---|
| `enableAutoParse` | `true` | 自动识别群消息里的红果链接 |
| `autoDownload` | `true` | 群里直接发链接时，解析后是否自动下载 |
| `autoDownloadRange` | `shared` | 自动下载选集；`shared` = 分享链接指向集，`first` = 第 1 集，也可写 `1-3` / `全部` |
| `manjuEnable` | `true` | 是否启用 `kylin.hainanyuyue.com` 漫剧分享链接解析 |
| `manjuSearchLimit` | `5` | `video_id` 失效后，按剧名搜索官网时最多校验几条 |
| `maxEpisodesPerRequest` | `3` | 单条命令下载上限 |
| `maxFileSizeMB` | `100` | 单集体积上限，超了直接报错，0 为不限 |
| `sendType` | `video` | `video` 直接发视频，`file` 上传群文件 |
| `cleanupAfterSend` | `true` | 发送后删除本地临时文件 |
| `maxConcurrentDownloads` | `2` | 全插件同时处理的下载任务上限 |
| `transcodeVideo` | `false` | 转成 H.264/AAC，需含 libx264 的 FFmpeg |
| `videoTransport` | `file` | 本地路径发送，或 base64 供远程协议端使用 |
| `maxBase64SizeMB` | `30` | base64 视频发送体积上限 |
| `sessionToken` | 空 | 登录管理独立密钥，与 HONGGUO_SESSION_TOKEN 一致 |
| `searchLimit` | `8` | 搜索展示条数 |
| `sessionTTL` | `1800` | 解析结果缓存秒数，供 `#红果下载 1-3` 复用 |
| `requestTimeout` | `30000` | 页面请求超时 |
| `downloadIdleTimeout` | `60000` | 官网直链下载停滞判定 |
| `downloadRetries` | `2` | 单次下载内部重试 |
| `episodeRetries` | `2` | 整集重新取链+下载的重试轮数 |
| `tempDir` | `./temp` | 视频临时目录（相对 Yunzai 运行目录） |
| `apiServer` / `apiKey` | 空 | 自建服务地址与密钥，留空即只用官网 |
| `apiServerTimeout` | `180000` | 自建服务接口超时（首次要现签名+解密，给得宽些） |
| `apiServerIdleTimeout` | `300000` | 自建服务串流首字节等待时间 |

命令设置保存在 `config/config/settings.json`，优先级高于 YAML，且立即生效。
手动改 YAML 后发送 `#红果重载`；已被命令覆盖的选项应继续用 `#红果设置` 修改。
托管模式自动配置 sessionToken；已有远程桥接服务才需手动设置。两份配置和 runtime 目录都不要公开。

常用设置：`#红果设置 自动下载 关`、`#红果设置 选集 first`、`#红果设置 每次集数 3`、
`#红果设置 转码 开`、`#红果设置 传输 base64`。含空格的程序路径可用双引号包裹。

## 实现要点

- **`vid_list` 用括号配平解析**，不靠贪婪正则：从 `"vid_list"` 定位后扫描 `[`/`]`、
  跳过字符串内的括号与转义，再 `JSON.parse`，避免 HTML 里其它 JSON 干扰。
- **直链实时获取**：CDN 地址带时效签名，下载每集前现取，不缓存复用。
- **先写 `.part` 再改名**：避免断流产生半截文件被当成成品；失败会清掉残留文件。
- **网络异常分级重试**：单次下载重试 `downloadRetries` 次，整集再重试 `episodeRetries` 轮，
  第二次起自动回退官网链路（应对直链过期/自建服务抖动）。
- **会话按群 + 用户隔离**，避免 A 群解析的剧被 B 群用 `#红果下载` 命中。
- **分享链接多层解析**：同时扫描原链接和多次 URL 解码后的内容，识别 `video_series_id`、
  `series_id`、`seriesId`、`book_id`、`album_id` 等参数；短链会跟随 HTTP 跳转，并继续解析
  `meta refresh`、`location.replace/assign` 和页面 JSON 里的 `scheme`。一个链接里可能有多个候选，
  插件会逐个请求官网校验，遇到第一个能返回分集列表的 ID 才停止。
- **漫剧映射校验**：`ManjuAPI` 解析 `window._ROUTER_DATA` 后，用 `params.video_id`、标题和
  `chapter_ids` 重合度共同校验官网剧集页，避免把同名剧或推广页误当成目标。

## 已知限制

- 漫剧分享页的 `play_url` 只有 30 秒，正片必须走官网开放集或自建 `apiServer`，不能直接把预览地址当完整视频。
- 示例漫剧官网只开放前 3 集，第 4 集起会返回 404；其他集需可用 App 服务及相应内容权限，部署服务不保证全集可下。
- 官网链接里的短链（如 `applink.novelquickapp.com/xxxx`）如果是**纯推广链**（不带内容 ID），
  任何解析都拿不到剧集；插件会明确提示需要带 `series_id` 的分享链接或直接给剧集 ID。
- 自建服务方案依赖服务端环境（模拟器/签名服务）在线，否则自动走官网链路。
- 自建服务低清晰度（720p 及以下）是 bytevc2 编码，部分播放器解不了，默认建议 `best`（1080p HEVC）。
- 广告/付费集以服务端返回为准，插件不做解锁。
- 仅供个人学习与自用，请遵守相关服务条款，不要用于批量分发。

## 排错

| 现象 | 处理 |
|---|---|
| 解析失败提示「官网没有返回该剧的分集列表」 | 剧可能下架或 ID 有误，先 `#红果搜索 剧名` 找正确 ID |
| 解析失败提示「未能从分享链接中解析出剧集 ID」 | 短链是推广链，改用 App 内「复制链接」的原链接或剧集 ID |
| 视频发送失败后提示改用群文件 | 适配器不支持本地视频直发，把 `sendType` 改成 `file` |
| 下载报「文件 xxMB 超过限制」 | 调大 `maxFileSizeMB` |
| 下载报「下载停滞超过 xxx ms」 | 网络慢或服务端解密慢，调大 `downloadIdleTimeout` / `apiServerIdleTimeout` |
| `#红果帮助` 显示的数据源不对 | 检查 `apiServer`、`useApiServer`、`preferApiServer` 三项配置 |
| 发链接后不想自动下载 | 把 `autoDownload` 改成 `false`；仍可手动执行 `#红果下载` |
| 漫剧提示「官网只开放前 3 集」 | 可配置 App 数据源尝试有权访问的集数，不保证全集可下 |
| 本地服务启动失败 | `#红果状态` 查看诊断；检查 Python、设备在线状态和端口是否被占用 |
| 准备设备失败 | 确认设备已有 root、ADB 授权、App 已安装、网络可访问 Frida 发布页 |
| GitHub 或 pip 安装失败 | 检查 Bot 主机网络、代理、Python 3.10+ 和 venv；恢复后重试 `#红果安装` |
