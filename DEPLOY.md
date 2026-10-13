# 部署、登录与排错

官网路线适合先验证插件加载；要稳定下载分享集，配置托管 App 服务或已有 API。
三条路线共用一个插件，不要重复启动同端口 API。

## 基础环境

- 云崽 Node.js 20.19+ 或 22.12+，推荐当前 LTS。
- Bot 主机必须有 ffprobe，每次下载校验 MP4 及视频轨道。
- 转码另需含 libx264 的 ffmpeg；原生 icqq 上传视频本身也依赖 ffmpeg。
- 完整插件目录放入 `plugins/hongguo-drama` 后重启，JS 无额外 npm 依赖。

路径有空格时加双引号：

~~~text
#红果设置 FFprobe "C:/Program Files/ffmpeg/bin/ffprobe.exe"
#红果设置 FFmpeg "C:/Program Files/ffmpeg/bin/ffmpeg.exe"
~~~

## 路线 A：官网内容

保持 apiServer 为空，直接发官方分享链接或 `#红果搜索 剧名`。
不需要 Python 或安卓设备。已有 API 但希望完全停用时，主人私聊：

~~~text
#红果停止
#红果设置 服务地址 关闭
~~~

官网可能只开放部分集数；纯推广短链没有内容 ID 时会失败。
示例仅描述 `https://kylin.hainanyuyue.com/s/<share_id>` 形态，具体分享链接以用户有权访问的内容为准。
该路线只负责解析和官网明文直链；API 配置为空或 `preferApiServer=false` 时才完全走这里。

## 路线 B：插件托管 App 服务

额外要求：Bot 主机 Python 3.10+、ADB；已有 root 的安卓设备/模拟器及 ADB 授权。
Linux 可能需 python3-venv。插件不安装模拟器、不获取 root、不绕过验证码。
安装需要访问 GitHub、Python 包索引和 Frida 发布页。

依次在主人私聊执行：

~~~text
#红果管理
#红果设置 Python /完整路径/python
#红果设置 ADB /完整路径/adb
#红果安装
#红果设备
#红果设置 设备 实际序列号
#红果安装App /Bot主机上的绝对路径/base.apk
#红果准备设备
#红果启动
#红果登录
~~~

服务启动后，漫剧分享链接的流程变为：

~~~text
分享页 -> video_id + chapter_ids + 当前 vid
       -> 上游 /stream?vid=<当前 vid>
       -> 上游签名、取密文、spade 解包、离线解密
       -> 插件下载明文 MP4
~~~

`/episodes` 只用于补充剧名、封面等元数据；失败时仍使用分享页的 `chapter_ids`，
不会阻断当前分享集下载。

PATH 已配置可跳过工具设置；App 已安装可跳过安装App。
网络设备可先 `#红果连接 地址:端口`，成功后自动选中。
Windows APK 示例：`#红果安装App D:/zhuomian/base.apk`。

准备流程下载 Frida 16.7.19，支持 ADB 直接 root 和经 su 启动，设置本机 27042 转发。
默认单设备、单会话，不要让多个实例争用同一转发端口。
托管 API / 签名默认监听 127.0.0.1:18780 / 18781，自动生成三种独立服务密钥。

### 登录与同步

1. `#红果登录` 仅打开设备 App。
2. 在 App 内完成人工登录、验证码，确认“我的”页面账号正确。
3. 发 `#红果登录完成`，并在 App 打开视频页产生请求。
4. 查看 `#红果登录状态`。凭证存在、设备参数齐全、签名在线都不等于账号身份已验证。
5. 发有权访问的分享链接，检查下载、发送、实际播放。

插件不接受手机号、验证码或直接粘贴 Cookie/Token。会话保存于上游私有 config.json。
过期后在 App 重登并同步，不可仅依赖状态中的“已配置”。

### 停止、修复与升级

- 停止只回收插件拥有的本机 Python 服务，不停止设备 App、frida-server 或 ADB 转发。
- Bot 重启后重新 `#红果启动`；正常退出或控制管道断开时回收托管子进程。
- 更改设备、端口或密钥前先停止。停止后官网可用，漫剧自动降级依据实际解析数据源。
- 重装前先停止。`#红果安装` 检查清单和哈希，修复缺失/损坏的上游运行文件，保留账号 config.json。
- 安装开始即撤销旧 ready 状态，全部检查成功才重新就绪。失败后重试安装，不能靠旧标记启动。
- 旧版简单 ready 标记需重新安装升级清单，不会清空账号。

## 路线 C：已有 API

原版 server.py 支持数据接口，但登录管理需要本插件 server/run_bridge.py 扩展。
API Key 是上游 /admin 创建的普通下载密钥，不是 ADMIN_TOKEN；签名端口也不是 API 地址。

API 主机按固定上游提交 `5f8a58d10f48954bc9b6a58c9cd6418bf499feb9` 和
[上游文档](https://github.com/zhangbaio/hongguo) 准备依赖及签名服务，再启动桥接。
Linux 示例（上游目录中运行）：

~~~bash
export SIGN_SERVER=http://127.0.0.1:8001
export DEVICE_POOL_SIZE=0
export ADMIN_TOKEN=REPLACE_WITH_UNIQUE_ADMIN_SECRET
export HONGGUO_SESSION_TOKEN=REPLACE_WITH_UNIQUE_SESSION_SECRET
export ADB=/usr/bin/adb
export ADB_DEVICE=实际序列号
.venv/bin/python /opt/Yunzai/plugins/hongguo-drama/server/run_bridge.py --upstream . --host 127.0.0.1 --port 8000
~~~

PowerShell 使用 `$env:SIGN_SERVER='http://127.0.0.1:8001'` 等设置环境变量，
Python 为 `.venv/Scripts/python.exe`。路径、设备、端口、占位密钥均需替换。
三种密钥不得复用，登录管理 Key 至少 16 字符；同步要求一个签名服务且关闭设备池。

主人私聊配置：

~~~text
#红果设置 服务地址 http://API私有地址:8000
#红果设置 下载密钥 普通API密钥
#红果设置 登录密钥 独立登录管理密钥
~~~

此路线不要再启动插件的本地托管服务。Bot 与 API 不同机时 127.0.0.1 不指向另一台机器。
远程优先私网或 HTTPS；代理支持长时间 /stream 和 POST /admin/session/start、/sync。
日志不要记录 api_key 查询串。ADB、Frida、签名服务及 /grab 不可公开到互联网。
不要把账号 Cookie、`x-tt-token`、API Key、签名服务或设备会话提交到仓库、镜像或公开日志。

漫剧在 apiServer 已配置、useApiServer=true 且 preferApiServer=true 时，
直接使用分享页的 video_id、chapter_ids 和当前 vid，
不要求官网元数据或上游 /episodes 成功；下载时优先调用
/stream?vid=...&quality=... 解密。上游流失败后才回退官网同集，
官网仍未开放时会明确报告失败。

## 视频发送

默认 file 传输使用原始绝对路径，支持中文和空格。原生 icqq 群文件调用 fs.upload 的目录/名称参数，
包装群接口和好友使用各自 sendFile。适配器没有上传接口时会明确报错。

协议端不同机且没有共享路径时：

~~~text
#红果设置 传输 base64
#红果设置 转码 开
~~~

base64 默认原文件上限 30 MB，编码额外增加内存和请求体积；文件回退仍可能依赖共享路径。
HEVC 可下载不代表 QQ 客户端可播，必要时转 H.264/AAC。转码不能绕过 QQ 风控。

## 排错

| 现象 | 检查 |
| --- | --- |
| 官方域名 / 地址被拒绝 | 检查是否跳到非白名单、异常端口或私网；不要关闭安全检查 |
| 页面超时 / 过大 | 检查官网可达性，适度调整 requestTimeout / maxPageSizeMB |
| 视频检查失败 | ffprobe 是否可执行、接口是否真正返回 MP4 及视频轨道 |
| 分段响应被拒绝 | 修复代理缓存的 206 行为，完整下载必须返回完整 200 |
| 已下载但发送失败 | 检查协议端路径、ffmpeg、QQ 限额；远程尝试 base64 |
| 安装失败 / 未就绪 | 检查 Python 3.10+、venv、GitHub/pip、磁盘，停止后重装 |
| 设备准备失败 | 检查 ADB 授权、已有 root、App、架构和 Frida 版本 |
| 有凭证但下载失败 | App 内确认身份及权限，打开视频页后重新同步 |
| 漫剧集数正确但 /stream 失败 | 检查签名服务、设备 App、API Key；插件会用同一 vid 回退官网同集 |
| /episodes 返回 503 但分享集可下 | 正常容错；API 优先模式直接使用分享页 chapter_ids，不依赖 /episodes |
| 已下载但 QQ 不能播放 | 上游 1080p 可能是 HEVC；开启 H.264/AAC 转码 |
| YAML 修改未生效 | settings.json 优先，使用命令设置修改覆盖值 |

`config/config`、`runtime` 及备份含敏感配置，不提交 Git。更新前停止、私有备份，
再 `git pull --ff-only` 并重启；不要强制覆盖本地修改。复测见 [VERIFY.md](VERIFY.md)。

本项目只用于下载用户有权访问的内容。不要将 ADB、Frida、签名接口或媒体服务暴露到公网，
也不要使用本项目绕过登录、验证码、地区限制或付费权限。
