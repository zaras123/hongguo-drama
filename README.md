# 红果短剧 / 漫剧插件

在 Yunzai 或 TRSS-Yunzai 中发送红果分享链接，解析剧集、下载指定集并发送视频。

这是目录式插件，需要部署整个仓库，不是单文件 JS。

[部署说明](DEPLOY.md) | [验证记录](VERIFY.md) | [维护说明](HANDOVER.md)

## 支持范围

- 支持 Yunzai 和 TRSS-Yunzai。
- 支持短剧、漫剧分享链接、官方短链和 App scheme。
- 内置托管 API 服务，默认优先使用，失败自动回退官网。
- 启动后自动安装内置 API 运行环境；设备就绪时自动启动。
- Linux Bot 可连接中心 API 服务，不要求在每台服务器配置 Android 设备。
- 默认自动下载分享链接指向的集数。
- 支持指定集数、重试、官网回退、H.264/AAC 转码和 base64 传输。
- 支持主人私聊管理上游服务、Android 设备和 App 登录同步。

登录必须在红果 App 内人工完成。插件不接收手机号、验证码、Cookie 或 Token。

## 安装

环境要求：

- Node.js 20.19+ 或 22.12+
- `ffprobe` 可选；缺失时使用内置 MP4 结构检查
- 转码需要带 `libx264` 的 `ffmpeg`
- API 路线另需 Python 3.10+、ADB 和已 root 的设备或模拟器

安装插件：

~~~bash
cd /path/to/Yunzai
git clone https://github.com/zaras123/hongguo-drama.git plugins/hongguo-drama
~~~

重启 Bot。若工具不在 PATH：

~~~text
#红果设置 FFprobe /绝对路径/ffprobe
#红果设置 FFmpeg /绝对路径/ffmpeg
~~~

## 使用

安装后直接把分享链接发给 Bot，插件会解析并下载分享集。未安装内置 API 时会自动使用官网路线，
不需要额外配置 Python、ADB 或 Android 设备。

| 命令 | 作用 |
| --- | --- |
| 直接发分享链接 | 自动解析并下载分享集 |
| `#红果解析 <链接或ID>` | 只解析剧集并缓存 |
| `#红果下载 <链接> 1-3` | 下载指定集 |
| `#红果下载 2` | 下载上次解析的第 2 集 |
| `#红果搜索 剧名` | 搜索短剧或漫剧 |
| `#红果帮助` | 查看命令 |
| `#红果一键配置` | 安装并尝试启动内置 API |
| `#红果配置API <地址> <下载Key> [登录Key]` | 配置远程 API 并启用必需模式 |

选集支持 `1`、`1-3,5`、`第2集`、`1，2、4` 和 `全部`。

## 插件流程

### 官网路线

不需要 Python 或 Android 设备。

~~~text
分享链接
  -> 校验官方域名
  -> 解析剧集和分享集
  -> 从官网取当前集直链
  -> 下载 .part
  -> ffprobe 校验
  -> 重命名、发送、清理
~~~

官网只开放部分集数时，插件仍优先尝试分享集。页面开放数只作为提示，不参与总集数和分享集选择。

### 内置 API 路线

默认 `apiServer: builtin`。插件会在后台自动安装运行环境，设备就绪后自动启动并读取本地地址和密钥。
未自动完成时可发送 `#红果一键配置`，设备步骤见 [部署说明](DEPLOY.md)。

~~~text
分享链接
  -> 读取 video_id、chapter_ids、分享 vid
  -> /episodes 只用于补充元数据
  -> /stream?vid=<分享 vid>&quality=best
  -> 上游签名、取密文、spade 解包、离线解密
  -> 下载明文 MP4
  -> 发送和清理
~~~

`/episodes` 失败不影响分享集下载。`/stream` 失败时，插件会用同一个 vid 回退官网。
未安装、未启动或设备未就绪时，内置 API 连接失败会自动使用官网路线。

Linux 服务器推荐连接中心 API：

~~~text
#红果配置API https://api.example.com 下载Key 登录Key
~~~

该命令会同时开启 `apiRequired`，API 失败时不会回退官网。

## 常用配置

配置文件首次运行后生成在 `config/config/config.yaml`。

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| autoDownload | true | 发链接后自动下载 |
| autoDownloadRange | shared | 下载分享集 |
| maxEpisodesPerRequest | 3 | 单次最多下载集数 |
| maxFileSizeMB | 100 | 单文件大小上限，0 表示不限制 |
| downloadRetries / episodeRetries | 2 / 2 | 下载重试 / 重新取链重试 |
| sendType | video | 发送视频或文件 |
| videoTransport | file | file 或 base64 |
| transcodeVideo | false | 是否转为 H.264/AAC |
| apiServer | builtin | 内置 API；可填远程地址或关闭 |
| apiKey | 空 | 上游下载 Key |
| preferApiServer | true | 是否优先使用 API 解密流 |
| apiRequired | false | API 必需模式，不回退官网 |
| apiAutoSetup / apiAutoStart | true / true | 自动安装运行环境 / 设备就绪后自动启动 |

常用命令：

~~~text
#红果设置 自动下载 关
#红果设置 选集 shared
#红果设置 服务地址 内置
#红果设置 服务地址 关闭
#红果设置 发送方式 文件
#红果设置 传输 base64
#红果设置 转码 开
~~~

## 注意

- 只下载有权访问的内容，并遵守服务条款。
- 不要把 Cookie、Token、API Key、设备会话或签名服务暴露到公网或提交到仓库。
- 远程协议端没有共享路径时，使用 `videoTransport=base64`。
- 上游 1080p 可能是 HEVC；QQ 客户端不能播放时开启 H.264/AAC 转码。
- FFprobe 只验证容器和视频轨道，不保证上游内容完整或永久可用。
