# 部署说明

## 基础环境

- Yunzai 或 TRSS-Yunzai
- Node.js 20.19+ 或 22.12+
- `ffprobe` 可选；缺失时使用内置 MP4 检查
- 转码需要带 `libx264` 的 `ffmpeg`

把完整仓库放到 `plugins/hongguo-drama` 后重启 Bot。

~~~bash
cd /path/to/Yunzai
git clone https://github.com/zaras123/hongguo-drama.git plugins/hongguo-drama
~~~

## 路线 A：官网解析下载

这是默认开箱可用路线。插件未检测到可用的内置 API 时，会自动使用官网，
不需要配置 Python、ADB 或 Android 设备。

~~~text
#红果设置 服务地址 关闭
~~~

如果需要显式禁用所有 API 尝试，可以使用上一条命令。然后：

1. 不需要 Python 和 Android 设备。
2. 把用户有权访问的分享链接发给 Bot。
3. 插件解析剧集，默认下载分享链接指向的集数。

要重新启用内置 API：

~~~text
#红果设置 服务地址 内置
#红果启动
~~~

官网开放范围会变化。分享集始终优先，插件不会因为页面显示开放数较少就自动改成第 1 集。

## 路线 B：插件托管 App 服务

这是稳定下载分享集的推荐路线，只有安装并启动内置服务后才会自动启用。

插件启动后会自动下载固定版本运行文件和依赖；也可以手动发送：

~~~text
#红果一键配置
~~~

额外要求：

- Python 3.10+
- ADB
- 已 root 的 Android 设备或模拟器
- 红果 App
- Frida 16.x

在主人私聊依次执行：

~~~text
#红果设置 Python /完整路径/python
#红果设置 ADB /完整路径/adb
#红果一键配置
#红果设备
#红果设置 设备 实际序列号
#红果安装App /绝对路径/base.apk
#红果准备设备
#红果启动
#红果登录
~~~

在 App 内完成人工登录后：

~~~text
#红果登录完成
#红果登录状态
~~~

启动后的下载流程：

~~~text
漫剧分享链接
  -> 分享页读取 video_id、chapter_ids、分享 vid
  -> /stream?vid=<分享 vid>&quality=best
  -> 上游签名、取密文、离线解密
  -> 插件下载明文 MP4
  -> 发送文件或视频
~~~

`/episodes` 失败不影响分享集下载。`/stream` 失败时回退官网同 vid。
服务启动后地址和密钥会自动写入配置，不需要手工填写。

## 路线 C：已有 API 服务

已有 `zhangbaio/hongguo` 服务时，把服务地址改为远程地址，不再启动插件的托管服务。

主人私聊配置：

~~~text
#红果设置 服务地址 http://API地址:8000
#红果设置 下载密钥 普通API密钥
#红果设置 登录密钥 独立登录管理密钥
~~~

要求：

- API 服务固定使用上游提交 `5f8a58d10f48954bc9b6a58c9cd6418bf499feb9`。
- 下载 Key 不是 `ADMIN_TOKEN`。
- 签名端口不是 API 地址。
- 远程连接优先使用私网、SSH 隧道或 HTTPS。

## 视频发送

默认使用原始文件路径：

~~~text
#红果设置 发送方式 视频
#红果设置 传输 file
~~~

远程协议端没有共享磁盘时：

~~~text
#红果设置 传输 base64
#红果设置 转码 开
~~~

`base64` 默认限制原文件 30 MB。HEVC 可以下载不代表 QQ 客户端能播放，需要时可转 H.264/AAC。

## 排错

| 现象 | 检查 |
| --- | --- |
| 解析失败 | 确认是官方分享域名，链接未失效 |
| 官网直链 404 | 插件会重新取链并重试，仍失败可配置 API 路线 |
| `/episodes` 失败 | API 优先模式不依赖它，直接按分享 vid 下载 |
| `/stream` 失败 | 检查签名服务、App 登录、设备在线和 API Key |
| 视频检查失败 | 检查 `ffprobe` 是否可执行 |
| 已下载但发送失败 | 检查协议端文件能力，尝试 `base64` |
| QQ 无法播放 | 开启 H.264/AAC 转码 |
| 配置不生效 | `settings.json` 优先于 YAML，发 `#红果重载` |

不要把 `config/config`、`runtime`、设备会话或服务密钥提交到 Git。
