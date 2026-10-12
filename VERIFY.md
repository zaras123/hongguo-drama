# 测试与功能验收

日期：2026-10-13。基线：0.3.0 / 7b364e7，本记录针对其后的修复版本，具体提交以 Git 历史为准。
环境：Windows、Node.js 24.11.1、FFmpeg/ffprobe；Python 单测及托管夹具使用现有 3.9 测试环境，
安装器生产要求仍为 Python 3.10+。

## 本轮结果

| 测试集 | 结果 | 范围 |
| --- | --- | --- |
| tests/workflow.test.mjs | 12 通过 | 登录管理权限、设置、HTTP 下载/发送/清理、base64、真实转码、托管生命周期 |
| tests/regressions.test.mjs | 11 通过 | URL/私网/DNS 固定连接、跳转、body 超时/大小、坏视频/206/断流、并发串集、发送契约、降级 |
| tests/pages.test.mjs | 6 通过 | 官网信息/搜索、短链/scheme、多 ID、API 回退、漫剧数据源 |
| server/test_*.py | 16 通过 | 会话鉴权/同步、安装修复、旧清单升级、失败撤销就绪、ADB root/su 参数 |
| 工作区旧离线页面回归 | 74 通过 | 原有真实页面样本、选集、漫剧、回退和命令 |

共 119 项通过。仓库内可复现的是 45 项；另外 74 项依赖历史工作区离线样本，不随仓库交付。
旧测试中 example.com 分享夹具已改为官方域名，伪 MP4 已改为真实生成视频；保留解析与下载断言，
不通过放宽生产安全检查迁就夹具。新仓库测试使用 FFmpeg 生成的 0.4 秒测试图视频，不包含平台影视内容。

另完成两次当前官网只读检查，使用修复后的实际 HTTPS / DNS 请求路径：
- 短剧官网返回《家父渊天尊第二季》168 集。
- 用户给出的 kylin 短链返回《重生之绝世仙帝!》113 集、分享第 5 集，页面声明开放 30 集。
  本轮没有实际下载这些影视内容，页面声明不等于已验证每集可下载。旧样本开放 3 集不能作为当前事实。

节点测试已启用真实 FFmpeg 转码与 Python 生命周期，29 项无跳过。
文件发送是依据 icqq 0.6.10 发布源码及云崽包装接口的本地契约验证，不是 QQ 网络实发。
ffprobe 只验证容器与视频流信息，不执行整片逐帧解码；正常封装但语义截短的上游视频不能仅凭 HTTP 判断。

## 缺陷闭环

| 编号 | 修复 | 回归证据 |
| --- | --- | --- |
| R1 | 官方域名、端口与凭据校验；逐跳验证；私网拦截；DNS 地址固定到 socket | 非主人 loopback 消息零请求、恶意主机、私网 DNS、固定 lookup、跳转拦截 |
| R2 | 页面 body 纳入 deadline；解压后大小限制；全插件解析并发闸门 | 延迟 body、超大页面、gzip 解压后限额、跨实例并发释放 |
| R3 | 拒收文本；每次下载后 ffprobe 验证 MP4 及视频轨道 | text/plain、octet-stream 假文件拒收，真实视频通过 |
| R4 | 完整请求拒绝 206 / Content-Range；长度检查 | 部分范围、断流拒收，不留 .part |
| R5 | 原始绝对路径传入视频接口，不做百分号编码 | 中文和空格文件名可被 icqq 路径处理规则直接读取 |
| R6 | 原生群 fs.upload(file, pid, name) 与包装群/好友 sendFile 分开 | 目录为 /、文件名第三参数、视频失败回退 |
| R7 | 清单记录文件哈希；重装修复缺失/损坏文件及旧清单 | 删除签名脚本、篡改 oracle、保留会话 |
| R8 | 安装前撤销 ready，全部通过后原子写入；状态检查必要文件 | 成功后重装失败不能保留旧就绪状态 |
| R9 | 漫剧依据 backend=web 的实际结果降级 | API 配置存在但官网回退时改下开放首集 |
| C1 | 分享文本和错误改为请求局部结果 | 同一 API 实例两个并发解析各自保留正确分享集 |
| C2 | su -c 完整命令进行远端引用 | ADB root / su 两条参数夹具通过 |

另修复 downloadRetries=0 被默认值覆盖；下载增加总时限；媒体工具禁止联网协议。
原生群文件优先 fs.upload；仅暴露 sendFile 的自定义包装器仍必须符合部署文档的二参数约定。

## 复测命令

在插件目录执行，ffprobe 必须在 PATH 或由 HG_FFPROBE 指定：

~~~bash
npm test
python -B -m unittest discover -s server -p 'test_*.py' -v
~~~

Python 单测环境需 FastAPI、requests、httpx；完整生命周期需 uvicorn。
Node 默认会跳过外部 Python 生命周期及可选真实转码两项；正式回归应启用它们。

PowerShell 完整示例（路径替换为实际路径）：

~~~powershell
$env:HG_FFPROBE='D:/ffmpeg/bin/ffprobe.exe'
$env:HG_FFMPEG='D:/ffmpeg/bin/ffmpeg.exe'
$env:HG_TEST_FFMPEG='1'
$env:HG_TEST_PYTHON='C:/Python312/python.exe'
node --test tests/*.test.mjs
~~~

Linux 示例：

~~~bash
HG_TEST_FFMPEG=1 HG_TEST_PYTHON=/opt/test-venv/bin/python node --test tests/*.test.mjs
~~~

测试使用临时目录、本机 HTTP 夹具与模拟设备命令，不需要真实账号，不运行真实 ADB/root 操作。
测试结束关闭服务、回收托管进程、删除临时文件。不能将真实会话或密钥放入测试夹具。

## 仍需实机验收

1. 目标云崽加载器及实际适配器加载插件，确认权限与命令匹配。
2. 安装 APK，验证设备 CPU、root、Frida 16.7.19 和固定上游脚本的动态兼容性。
3. App 内人工登录，同步会话并确认账号身份；状态接口本身不会验证身份。
4. 发自有合法分享链接，检查当前平台页面、可访问集数、真实下载与播放。
5. QQ 实发：中文路径视频、转码、文件回退、远程 base64、QQ 限额。
6. Linux 部署和长期运行测试；本轮不宣称已完成 Linux 实测。

当前 Semgrep MCP 仅返回弃用通知，未完成 Semgrep 扫描，也未进行第三方依赖 CVE 全量扫描。
测试通过只证明已覆盖的行为，不是“没有任何 bug”或平台接口永久可用的保证。
