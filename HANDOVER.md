# 维护说明

## 当前流程

1. 用户发送分享链接。
2. 插件识别漫剧或普通短剧。
3. 漫剧解析分享页：
   `video_id`、`chapter_ids`、`used_chapter_id`、`chapter_order`。
4. 默认 `apiServer: builtin`；内置服务未就绪时自动关闭 API，直接使用官网。
   插件后台自动安装运行环境，设备就绪时自动启动并读取本地地址和密钥。
   Linux 用户也可通过 `#红果配置API` 或环境变量连接中心 API，并开启 API 必需模式。
5. API 优先时，先尝试 `/episodes` 补充元数据。
6. `/episodes` 失败或不匹配时，直接使用分享页 `chapter_ids`。
7. 下载分享 vid：
   `/stream?vid=...&quality=...`。
8. 上游完成签名、取密文、`spade_a` 解包和离线解密。
9. 上游失败或服务未启动时，使用同一个 vid 回退官网。
10. 文件写入 `.part`，校验后原子改名。
11. 发送视频或文件，按配置清理。

分享页开放集数只提示，不参与总集数和分享集选择。

## 关键边界

- 插件不接收手机号、验证码、Cookie 或 Token。
- App 登录必须在设备内人工完成。
- 私密 API 是独立信任边界，可以位于私网。
- 公共分享链接只允许官方域名。
- Cookie、API Key、设备会话和服务密钥不得提交到 Git。

## 数据目录

| 路径 | 内容 |
| --- | --- |
| `config/default_config` | 公共默认配置 |
| `config/config` | 私有配置和命令覆盖 |
| `runtime/upstream/config.json` | App 会话 |
| `runtime/service.json` | 服务密钥 |
| `runtime/installed.json`、`ready.json` | 安装清单和就绪状态 |
| `runtime/venv` | 专用 Python 环境 |
| `tests/fixtures/video.mp4` | 自生成测试视频 |

## 升级步骤

1. 执行 `#红果停止`。
2. 备份 `config/config` 和 `runtime`。
3. 更新源码，不覆盖本地私有配置。
4. 确认 `ffprobe` 可用。
5. 重启 Bot。
6. 必要时执行 `#红果安装` 重建上游清单。
7. 先验证官网分享链接，再验证 App 服务和消息发送。

## 上游依赖

固定上游：`zhangbaio/hongguo`

固定提交：`5f8a58d10f48954bc9b6a58c9cd6418bf499feb9`

插件不附带 APK、模拟器、账号、Cookie 或 GitHub Token。
