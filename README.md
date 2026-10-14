# 红果短剧 / 漫剧插件

在 Yunzai 或 TRSS-Yunzai 中解析红果分享链接、下载剧集并发送视频。

默认优先使用离线游客 API；未配置外部签名服务时自动走官网兜底。

[部署与配置](DEPLOY.md) | [验证记录](VERIFY.md) | [维护说明](HANDOVER.md)

## 默认模式

| 模式 | 用途 | 必要配置 |
| --- | --- | --- |
| 离线游客 API | 默认优先，公开内容不依赖 App | `externalSignServer`、`devicePoolSize` |
| 中心 API | Linux 多机共享 | `apiServer`、`apiKey`、`sessionToken` |
| 官网兜底 | 没有可用 API 时 | 无需设备 |

`offlineApi` 默认是 `true`，但必须提供外部 unidbg/FqTrace 签名服务才能生效。

## 推荐配置

### 1. 离线游客 API

先启动外部 unidbg 签名服务，然后配置：

```text
#红果设置 离线API 开
#红果设置 签名服务 http://unidbg主机:9099
#红果设置 设备池 20
#红果设置 API必需 开
#红果一键配置
```

环境变量方式：

```text
HONGGUO_OFFLINE_API=1
HONGGUO_SIGN_SERVER=http://unidbg主机:9099
HONGGUO_DEVICE_POOL_SIZE=20
HONGGUO_API_REQUIRED=1
```

说明：

- 游客开放内容可以不用红果 App 和账号 Token。
- 需要账号权限的内容仍需要中心服务维护有效 Token。
- `HONGGUO_API_REQUIRED=1` 时，API 不可用不会回退官网。

### 2. 中心 API

Linux Bot 只连接中心 API：

```text
#红果配置API https://api.example.com 下载Key 登录Key
```

等价环境变量：

```text
HONGGUO_API_URL=https://api.example.com
HONGGUO_API_KEY=下载Key
HONGGUO_SESSION_TOKEN=登录Key
HONGGUO_API_REQUIRED=1
```

### 3. 官网兜底

完全不使用 API：

```text
#红果设置 服务地址 关闭
```

官网只保证当前开放内容，不能保证分享集全集可下载。

## 安装

```bash
cd /path/to/Yunzai
git clone https://github.com/zaras123/hongguo-drama.git plugins/hongguo-drama
```

要求：

- Node.js 20.19+ 或 22.12+
- `ffprobe` 可选，缺失时使用内置 MP4 校验
- 转码需要带 `libx264` 的 `ffmpeg`

## 常用命令

```text
#红果帮助
#红果解析 <链接或ID>
#红果下载 <链接> 1-3
#红果下载 2
#红果搜索 剧名
#红果一键配置
#红果配置API <地址> <下载Key> [登录Key]
```

## 编辑配置

配置文件：

```text
config/config/config.yaml
```

命令覆盖：

```text
config/config/settings.json
```

安装锅巴后，可在锅巴插件配置页修改基础、API、离线 API、发送和托管设备设置。

常用设置：

```text
#红果设置 自动下载 开|关
#红果设置 选集 shared|first|1-3
#红果设置 发送方式 视频|文件
#红果设置 传输 file|base64
#红果设置 转码 开|关
```

## 注意

- 只下载有权访问的内容，并遵守平台服务条款。
- 不要把 Cookie、Token、API Key、设备会话或签名服务提交到公开仓库。
- 远程协议端没有共享路径时使用 `base64`。
- HEVC 能下载不代表 QQ 客户端能播放，需要时开启 H.264/AAC 转码。
