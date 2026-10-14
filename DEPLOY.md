# 部署与配置

## 基础环境

- Yunzai 或 TRSS-Yunzai
- Node.js 20.19+ 或 22.12+
- `ffprobe` 可选
- 转码需要带 `libx264` 的 `ffmpeg`

安装：

```bash
cd /path/to/Yunzai
git clone https://github.com/zaras123/hongguo-drama.git plugins/hongguo-drama
```

重启 Bot 后可直接发送分享链接。

---

## 默认优先：离线游客 API

适用：

- Linux 服务器
- 不想在每台机器安装模拟器或 App
- 公开、游客可访问的内容

外部先启动 `FqTrace serve`：

```bash
java --add-opens java.base/java.lang=ALL-UNNAMED \
  -cp unidbg-sign-1.0-jar-with-dependencies.jar \
  com.hongguo.sign.FqTrace serve 9099
```

插件配置：

```text
#红果设置 离线API 开
#红果设置 签名服务 http://unidbg主机:9099
#红果设置 设备池 20
#红果设置 API必需 开
#红果一键配置
```

环境变量：

```text
HONGGUO_OFFLINE_API=1
HONGGUO_SIGN_SERVER=http://unidbg主机:9099
HONGGUO_DEVICE_POOL_SIZE=20
HONGGUO_API_REQUIRED=1
```

说明：

- 游客接口不需要红果账号 Token。
- 需要账号权限的内容仍不保证可下载。
- API 必需模式下不会回退官网。

---

## 中心 API

适用：

- 多台 Linux Bot 共用一个 API
- API 主机维护设备和 Token
- 客户端不安装 Python、ADB、Frida

客户端配置：

```text
#红果配置API https://api.example.com 下载Key 登录Key
```

环境变量：

```text
HONGGUO_API_URL=https://api.example.com
HONGGUO_API_KEY=下载Key
HONGGUO_SESSION_TOKEN=登录Key
HONGGUO_API_REQUIRED=1
```

中心 API 主机负责：

```text
Android 设备 / 模拟器
红果 App 登录
签名服务
/stream 解密
Token 维护
```

---

## 本地设备 API

适用：

- Bot 主机或局域网内有 Android 设备
- 需要账号内容或完整登录态

```text
#红果设置 Python /完整路径/python
#红果设置 ADB /完整路径/adb
#红果一键配置
#红果设备
#红果设置 设备 实际序列号
#红果安装App /绝对路径/base.apk
#红果准备设备
#红果启动
#红果登录
```

在 App 内人工登录后：

```text
#红果登录完成
#红果登录状态
```

---

## 官网兜底

不用 API：

```text
#红果设置 服务地址 关闭
```

特点：

- 不需要 Python、ADB、Frida
- 只下载官网当前开放内容
- 分享集会优先尝试，不因页面开放数自动改集

---

## 视频发送

默认：

```text
#红果设置 发送方式 视频
#红果设置 传输 file
```

远程协议端没有共享路径：

```text
#红果设置 传输 base64
#红果设置 转码 开
```

---

## 锅巴配置

已安装锅巴时，可在插件配置页修改：

- 基础功能
- API
- 离线 API
- 发送与转码
- 托管与设备

保存后写入：

```text
config/config/settings.json
```

---

## 排错

| 现象 | 处理 |
| --- | --- |
| 离线 API 不启动 | 检查 `SIGN_SERVER`、`offlineApi`、`devicePoolSize` |
| 中心 API 401 | 检查 `apiKey` |
| 登录管理 401 | 检查 `sessionToken` |
| API 不可用 | 开启官网兜底或修复签名服务 |
| `/stream` 失败 | 检查签名服务、Token、设备池 |
| QQ 无法播放 | 开启 H.264/AAC 转码 |
| 配置不生效 | 发 `#红果重载` |

敏感配置不要提交到 Git。
