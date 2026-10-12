# 部署与首次登录

本交付包含云崽插件、上游自动安装器、进程托管及登录管理扩展。真实登录在红果 App 中完成，
支持 App 内手机号/验证码等现有登录方式；没有实现独立于 App 的短信或扫码登录接口。
插件不接收手机号、验证码、Cookie 或 x-tt-token。

## 推荐：在插件内完成部署

将整个 hongguo-drama 目录放入云崽 plugins，重启 Bot，主人私聊发送 `#红果管理`。
无需预先克隆上游或手动填写密钥。安装过程需要访问 GitHub 和 Python 包索引，不含模拟器自动安装。

1. Bot 主机准备 Python 3.10+、ADB、FFmpeg/ffprobe；Linux 可能还需系统的 python3-venv 包。
2. 发送 `#红果安装`，等待环境安装完成。路径不在 PATH 时先 `#红果设置 Python /完整路径/python`。
3. 启动已有 root 的安卓设备/模拟器，启用 ADB。发送 `#红果设备`，再 `#红果设置 设备 实际序列号`。
4. 网络设备可用 `#红果连接 127.0.0.1:5555`，地址和端口按实际替换；该命令会选中连接后的设备。
5. App 未安装时发送 `#红果安装App /Bot主机上的完整路径/base.apk`。Windows 示例：`#红果安装App D:/zhuomian/base.apk`。
6. 发送 `#红果准备设备`，安装匹配 CPU 架构的 Frida 16.7.19 并配置本机 ADB 转发。不会替设备获取 root。
7. 发送 `#红果启动`，自动启动本机签名/API 服务并配置插件。默认使用 18780 和 18781 端口，仅监听本机。
8. 发送 `#红果登录`，在设备 App 内自行完成登录及验证；随后 `#红果登录完成`，保持 App 在线并打开视频页。
9. 发送 `#红果登录状态`，再发分享链接检查解析、下载和发送；状态中的凭证存在不代表账号身份已验证。

管理命令均限主人私聊。日常使用只需发链接，或 `#红果下载 2`、`#红果下载 1-3`。
已有 App 可跳过安装App；没有设备时可先安装环境，并使用官网开放集，不能完成 App 登录验收。

### 设置与运行文件

- `#红果设置` 查看可调整的设置，中文命令即时生效；例如 `#红果设置 自动下载 开`、`#红果设置 转码 开`。
- `#红果状态` 查看安装进度、服务状态和登录同步状态；`#红果停止` 只停止插件拥有的 Python 服务进程。
- Bot 重启后重新发送 `#红果启动`；Bot 正常退出或控制管道断开时，托管进程会清理 API 与签名子进程。
- 改设备、服务端口或服务凭据前先停止服务。默认准备流程使用本机 27042 转发，只支持一个账号设备。
- 命令配置在 `config/config/settings.json`，优先于 `config/config/config.yaml`；用命令改过的选项不要再仅改 YAML。
- `runtime/upstream` 存放固定版本上游和账号 config.json；`runtime/venv` 是独立环境；`runtime/service.json` 保存三种独立密钥。
- 文件以私有权限创建，Windows 上另由主机账号 ACL 保护。不要公开 config/config、runtime、备份或运行时日志。
- 安装器固定上游提交 `5f8a58d10f48954bc9b6a58c9cd6418bf499feb9` 并验证文件 Git blob SHA。重复安装保留账号配置。

`#红果停止` 不会停止设备上的 App、frida-server 或删除 ADB 转发。需完全停止设备侧服务时由设备管理员操作。
连接已有远程 API 的用户可用 `#红果设置 服务地址 http://私有地址:8000`，并分别设置下载密钥和登录密钥，
不需要 `#红果安装` 或 `#红果启动`。只提供签名服务时可设置“签名服务”，但仍需在本机托管 API。

以下章节为高级手动部署路线，与上面的插件托管模式二选一，不要同时占用同一服务端口。

## 环境要求

- 云崽：Node.js 20.19+ 或 22.12+，推荐当前 LTS，需要内置 fetch。
- 上游：Python 3.10+ 和仓库 requirements.txt 中的依赖。
- 签名设备：安卓设备或模拟器、红果 App、ADB、Frida 后端，按上游说明部署。
- 可选转码：包含 libx264 的 FFmpeg 和 ffprobe，默认关闭，启用后更适合 QQ 视频发送。

上游参考：[zhangbaio/hongguo](https://github.com/zhangbaio/hongguo)。
核对时 HEAD 为 5f8a58d10f48954bc9b6a58c9cd6418bf499feb9。
App 和 Frida 脚本版本兼容性要在实际设备验证，静态分析 APK 不等于动态签名已通过。

## 准备上游

~~~bash
git clone --filter=blob:none https://github.com/zhangbaio/hongguo.git
cd hongguo
python -m venv .venv
~~~

Windows PowerShell：

~~~powershell
./.venv/Scripts/python.exe -m pip install -r requirements.txt
Copy-Item -LiteralPath config.example.json -Destination config.json
~~~

Linux：

~~~bash
.venv/bin/python -m pip install -r requirements.txt
cp config.example.json config.json
~~~

仅在没有 config.json 时复制模板。初始占位会话可以启动服务，App 数据接口要等同步成功后才可用。
核对 config.json 的 api_host 与设备实际 API 域名一致；不匹配时同步会报错并保留旧配置。
按上游文档准备 ADB、红果 App 和 frida-server。Frida 客户端与服务端版本、CPU 架构需匹配。
用 adb devices -l 检查设备；不要将 ADB 和签名服务端口公开到互联网。

## 启动签名服务

在上游目录的第一个终端启动，设备序列号填写 adb devices -l 的实际结果。

Windows PowerShell：

~~~powershell
$env:ADB = 'D:/leidian/LDPlayer9/adb.exe'
$env:ADB_DEVICE = 'emulator-5554'
$env:FRIDA_HOST = '127.0.0.1:27042'
./.venv/Scripts/python.exe sign_server.py
~~~

Linux：

~~~bash
export ADB=/usr/bin/adb
export ADB_DEVICE=127.0.0.1:5555
export FRIDA_HOST=127.0.0.1:27042
.venv/bin/python sign_server.py
~~~

上游默认绑定 127.0.0.1:8001，根接口 ready=true 表示签名就绪，不代表账号已登录。

## 启动带登录管理的 API

使用本插件的 server/run_bridge.py 启动上游 API，不要同时启动另一份占用 8000 的 server.py。
启动器复用原有 API 和内存配置；同步后当前进程立即使用新会话，同时原子保存 config.json。

| 字段 | 用途 | 配置位置 |
| --- | --- | --- |
| ADMIN_TOKEN | 上游 /admin 密钥管理 | 服务环境变量 |
| apiKey | 搜索、分集、视频流 | /admin 生成后填插件配置 |
| HONGGUO_SESSION_TOKEN / sessionToken | 启动 App、同步会话、查状态 | 服务与插件填写同一值 |

三种密钥分开设置。可分别运行下面命令生成管理密钥并保存到私有部署配置：

~~~bash
python -c "import secrets; print(secrets.token_hex(32))"
~~~

下面的占位密钥和路径都需要替换。在上游目录的第二个终端运行：

~~~powershell
$env:SIGN_SERVER = 'http://127.0.0.1:8001'
$env:DEVICE_POOL_SIZE = '0'
$env:ADMIN_TOKEN = 'REPLACE_WITH_UNIQUE_ADMIN_SECRET'
$env:HONGGUO_SESSION_TOKEN = 'REPLACE_WITH_UNIQUE_SESSION_SECRET'
$env:ADB = 'D:/leidian/LDPlayer9/adb.exe'
$env:ADB_DEVICE = 'emulator-5554'
./.venv/Scripts/python.exe 'C:/plugins/hongguo-drama/server/run_bridge.py' --upstream . --host 127.0.0.1 --port 8000
~~~

Linux：

~~~bash
export SIGN_SERVER=http://127.0.0.1:8001
export DEVICE_POOL_SIZE=0
export ADMIN_TOKEN=REPLACE_WITH_UNIQUE_ADMIN_SECRET
export HONGGUO_SESSION_TOKEN=REPLACE_WITH_UNIQUE_SESSION_SECRET
export ADB=/usr/bin/adb
export ADB_DEVICE=127.0.0.1:5555
.venv/bin/python /opt/Yunzai/plugins/hongguo-drama/server/run_bridge.py --upstream . --host 127.0.0.1 --port 8000
~~~

两个终端分别设置环境变量。API 与签名主机不同机器时，SIGN_SERVER 改为可达的私有地址。
登录命令使用 API 主机的 ADB；设备仅在签名主机时，请手动打开 App，直接同步登录即可。
账号会话模式只支持一个 SIGN_SERVER，且关闭设备池，以免混用设备身份。

Bot 不在 API 同一宿主机时，绑定需要的网卡，通过私网或 HTTPS 反向代理访问。
代理需支持 POST /admin/session/start、POST /admin/session/sync 和长时间 GET /stream。
不要在代理日志记录带 api_key 的查询串。签名服务 /grab 返回敏感会话，只供内部使用。

## 安装与配置插件

将 hongguo-drama 目录放入云崽 plugins，重启 Bot，修改自动生成的
plugins/hongguo-drama/config/config/config.yaml：

~~~yaml
apiServer: "http://127.0.0.1:8000"
apiKey: "从API的admin页面生成的普通密钥"
sessionToken: "REPLACE_WITH_UNIQUE_SESSION_SECRET"
useApiServer: true
preferApiServer: true
enableAutoParse: true
autoDownload: true
autoDownloadRange: "shared"
transcodeVideo: true
ffmpegPath: "ffmpeg"
ffprobePath: "ffprobe"
videoTransport: file
~~~

apiServer 是 API 根地址，不是 GitHub 地址或签名端口 8001。
访问 API 的 /admin，用 ADMIN_TOKEN 创建普通 Key，填入 apiKey。
Bot 和协议端不同机器且不共享路径时，可使用 videoTransport: base64，
同时核对 maxBase64SizeMB 和适配器消息体上限。群文件回退仍取决于适配器能否读取本地文件。

## 首次登录与验收

1. 主人发送 #红果重载 应用配置。
2. 主人私聊发送 #红果登录，在设备中进入 App 的“我的”并完成登录、验证码。
3. 主人私聊发送 #红果同步登录，等待期间在 App 打开视频页，产生请求供签名服务捕获。
4. #红果登录状态 应显示凭证、设备参数已配置和签名在线。此状态不验证账号身份。
5. 发分享链接，确认收到剧集信息与可播放视频；再发 #红果下载 2 检查会话选集。
6. 默认自动下载分享集，单次最多 3 集。无服务时示例漫剧官网仅开放前 3 集。

凭证只保存在上游 config.json，插件不保存或回传红果 Cookie/Token。
上游遇到登录态过期时会尝试 /grab 刷新；App 已退出登录时，需要重新登录后同步。
插件不能替代验证码或恢复失效账号会话。

## 验证范围

在插件目录运行：

~~~bash
node --test tests/workflow.test.mjs
python -B -m unittest discover -s server -p 'test_*.py' -v
~~~

Python 测试额外需要 httpx。FFmpeg 测试默认跳过，设置 HG_TEST_FFMPEG=1 启用，
HG_FFMPEG/HG_FFPROBE 可指定完整路径，需包含 libx264 编码器。
托管生命周期测试默认跳过，设置 HG_TEST_PYTHON 为已安装 FastAPI、uvicorn、requests 的 Python 完整路径启用；
测试会验证启动、停止、端口占用、Bot 控制管道退出、异常退出和凭据保留，不需要真实账号或设备。
本次通过模拟服务、离线样本、真实 FFmpeg 转码、Python 3.12 独立环境安装，以及固定版本上游 API 的
无账号启动/鉴权/停止验证。尚未实测设备登录、Frida 兼容性和 QQ 网络发送，详见 VERIFY.md。
会话存在或 /episodes 成功不能证明账号身份有效，也不保证全集可下，内容访问以实际 App 和服务返回为准。
