# 维护与交付

日期：2026-10-13。修复基线：提交 7b364e7，插件元数据 0.3.0。
本轮修复随仓库源码交付，具体提交以 Git 历史为准；未创建独立 Release。

## 入口

- [README.md](README.md)：能力、命令、数据流程、配置与安全边界。
- [DEPLOY.md](DEPLOY.md)：官网、托管 App 服务、已有 API 三条路线，登录与排错。
- [VERIFY.md](VERIFY.md)：本轮测试数、缺陷闭环、复测命令、实机验收。

## 修复范围

前次审查的 9 项缺陷和 2 项条件性风险均已落实代码与回归：
URL/内网请求防护、响应体超时、视频格式及完整性、icqq 路径与群文件参数、
安装修复与旧就绪撤销、漫剧 API 停止后的选集降级、并发解析状态隔离、su 命令引用。

新模块 components/Http.js 使用 Node 原生 HTTP(S)，将解析出的公网 IP 固定到连接。
保持原始 hostname 供 Host / TLS SNI 使用；每跳重新验证。私有 API 是主人显式配置的信任边界。
页面请求有 body 时限与大小限制；媒体下载独立流式写盘并受体积、停滞和总时限约束。

## 升级注意

1. 先 `#红果停止`，备份私有 config/config 和 runtime，不上传备份。
2. 更新源码，保留运行配置和账号文件，不强制覆盖用户本地代码修改。
3. Bot 主机安装 ffprobe，所有下载现在均要求有效 MP4 与视频轨道，不能再用伪文件头通过校验。
4. 重启 Bot。旧 ready 标记不满足新格式时，重新 `#红果安装`，保留账号配置但重建经过校验的清单。
5. 主人先走官网样本验收，再启动 App 服务和真实 QQ 发送验收。

默认清理会删除发送失败的本地视频；需要排错时可在私有 YAML 中设置 cleanupAfterSend=false，
注意磁盘容量，处理后恢复。remote base64 只解决视频消息取文件，不保证所有适配器的群文件上传支持远程路径。

## 数据归属

| 路径 | 内容 | 处理 |
| --- | --- | --- |
| config/default_config | 公共默认值 | 随代码交付 |
| config/config | YAML、命令覆盖与服务密钥 | 私有备份，Git 忽略 |
| runtime/upstream/config.json | App 会话 | 私有备份，不展示在聊天 |
| runtime/service.json | 三种服务密钥 | 私有备份，不公开 |
| runtime/installed.json、ready.json | 上游文件清单、就绪状态 | 可由安装器重建 |
| runtime/venv | 专用 Python 环境 | 不跨主机复制使用 |
| tests/fixtures/video.mp4 | 自生成测试图，不含平台内容 | 可随测试交付 |

上游固定提交：`5f8a58d10f48954bc9b6a58c9cd6418bf499feb9`。
运行文件下载验证 Git blob SHA，重装检查本地完整性；本地账号 config.json 不在覆盖清单中。
上游许可及使用条件以其项目为准，插件不附带 APK、模拟器、账号或 GitHub 令牌。

## 后续验收

本轮 119 项通过，其中随仓库交付 45 项。设备登录、Frida 动态兼容、QQ 实发和 Linux 仍待目标环境验证。
不要把测试中的会话存在或本地消息桩通过写成真实登录/发送成功。详细清单见 VERIFY.md。
