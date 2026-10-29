# RPLink Community

一个基于 DeepSeek Harness 的本地角色扮演聊天工具：电脑端运行 DSH 插件，手机通过局域网 HTTPS/WSS 连接。

这个仓库是通用版：**不包含任何个人角色卡、聊天记录、表情包、API Key、生图服务地址或签名密钥。** 装好后由你自己创建角色。

## 功能

- 角色卡与章节，按章节保存聊天记录；
- 平行世界线：同一角色的多条互不干扰互动线；
- 聊天/见面模式；
- 打字状态、分段气泡、随机回复延迟；
- AI 表情包（可选，自行放置素材）；
- AI 生图接口（可选，自定义 HTTP provider）；
- 局域网 HTTPS + WSS，手机扫码配对；
- Android App 与桌面端双向消息同步。

## 目录

```text
plugin/    DSH 插件（Agent、提示词、章节、effects、HTTPS/WSS、生图接口）
preset/    DSH 角色扮演预设提示词
android/   Android 客户端源码
tools/     DSH 插件安装脚本
docs/      安装与扩展说明
```

## 需要准备

- Windows 上的 DeepSeek Harness Desktop；
- 一个可用的模型 provider（默认 `deepseek-official`，在 DSH 中配置）；
- 可选：Android 10 以上手机；
- 可选：一个兼容的生图 HTTP 服务，见 [生图 provider](docs/IMAGE_PROVIDER.md)；
- 可选：一个已有的 OpenViking HTTP 服务，见下文“记忆”。

## 安装电脑端插件

1. 安装依赖：

   ```bash
   cd plugin
   npm install --omit=dev
   ```

2. 把插件注册到 DSH 桌面 profile：

   ```bash
   node tools/install-desktop.mjs
   ```

   如果你的 profile 不在默认位置，可指定：

   ```bash
   node tools/install-desktop.mjs --profile=C:/Users/你的用户名/.dsh/profiles/desktop
   ```

3. 完全退出 DSH，再重新打开。

4. 打开 DSH 设置里的 **RPLink**，确认 provider / model。

5. 首次打开会生成一个“未命名角色”。在 RPLink 角色页编辑它，填入你自己的角色设定。

卸载/回滚：

```bash
node tools/install-desktop.mjs --rollback
```

## 安装手机端

从仓库的 Releases 下载 `RPLink-Community-debug.apk`，允许“安装未知来源应用”后安装。

手机和电脑必须在同一个局域网。电脑端 RPLink 设置里生成配对二维码，手机扫码即可。

也可以自行构建：

```bash
cd android
./gradlew assembleDebug
```

产物：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

发布正式版时请使用你自己的签名密钥，详见 [Android 构建说明](docs/ANDROID.md)。

## 可选：生图

通用版**不包含任何生图后端**。在 `plugin/cordis.patch.yml` 中配置：

```yaml
imageProvider:
  url: 'http://127.0.0.1:9000/generate'
  token: ''
```

接口约定和示例见 [docs/IMAGE_PROVIDER.md](docs/IMAGE_PROVIDER.md)。

角色卡里的 `image.cards` 是传给该 provider 的模型名/角色名列表，由你的 provider 自行解释。

## 可选：记忆

通用版不捆绑 OpenViking，也不会自动启动本地模型。若你已经有 OpenViking HTTP 服务，可在 RPLink 设置里填 `memoryEndpoint`，例如：

```text
http://127.0.0.1:1933
```

默认留空，此时不启用长期记忆，聊天照常工作。

## 可选：表情包

在 `plugin/assets/stickers/<pack>/` 放置图片和 `stickers.json`，然后在角色卡里填 pack 名称。格式见 [docs/STICKERS.md](docs/STICKERS.md)。

素材不会随仓库提供，需要你自己准备并确认版权。

## 隐私

仓库中不包含：

- 个人角色卡、聊天记录、章节；
- 表情包图片或截图；
- API Key、token、配对码；
- 个人电脑路径、局域网 IP、签名密钥；
- 任何第三方生图程序的源码或地址。

运行时数据写在 `~/.dsh/rp-bot/`，已被 `.gitignore` 排除。

## 开发说明

- `plugin/lib/bridge.js`：DSH agent、提示词、章节、隐藏标记；
- `plugin/lib/server.js`：HTTPS/WSS、配对、消息；
- `plugin/lib/images.js`：通用生图 provider 接口；
- `plugin/lib/stickers.js`：本地表情包；
- `plugin/lib/worldlines.js`：世界线；
- `android/`：Java/AppCompat 客户端。

## 已知限制

- 通用版不提供生图后端，不配置时生图不可用；
- 不配置 OpenViking 时没有长期记忆；
- 默认角色是空的，需要自己写人设；
- Android debug 包使用 debug 签名，不适合上架应用商店。

## 文档

- [安装与排错](docs/INSTALL.md)
- [生图 provider](docs/IMAGE_PROVIDER.md)
- [Android 构建](docs/ANDROID.md)
- [表情包格式](docs/STICKERS.md)
