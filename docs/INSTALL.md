# 安装与排错

## 电脑端

要求：

- Windows 10/11；
- 已安装并至少启动过一次 DeepSeek Harness Desktop；
- Node.js 20+（DSH 自带或系统安装均可）。

步骤：

```bash
cd plugin
npm install --omit=dev
cd ..
node tools/install-desktop.mjs
```

然后完全退出 DSH，重新打开。

如果 RPLink 没有出现在设置里：

1. 确认 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里有 `dsh-rp-bot`；
2. 确认 `~/.dsh/profiles/desktop/node_modules/dsh-rp-bot` 指向本仓库的 `plugin/`；
3. 执行回滚：
   ```bash
   node tools/install-desktop.mjs --rollback
   ```
   再重新安装。

## 手机端

1. 安装 APK；
2. 电脑端打 RPLink 设置，生成配对二维码；
3. 手机扫码。

手机与电脑必须处于同一局域网。路由器开启 AP 隔离时无法连接。

## 常见问题

### 手机提示连接不上

- 确认电脑端 RPLink 已启动；
- 确认 Windows 防火墙允许 DSH 的 3450 端口；
- 确认手机和电脑在同一 Wi-Fi；
- 不要在公网暴露 3450。

### 没有回复

- 检查 DSH 的模型 provider 是否配置正确；
- 打开 RPLink 设置，确认 model 名称可用；
- 查看 DSH 日志里的 `[rp-bot]`。

### 生图失败

通用版不带生图后端。需要配置 `imageProvider.url`，见 [IMAGE_PROVIDER.md](IMAGE_PROVIDER.md)。

### 没有记忆

通用版不自动启动 OpenViking。需要你已有 OpenViking HTTP 服务，并填写 `memoryEndpoint`。

### 升级后数据还在吗

数据在：

```text
~/.dsh/rp-bot/
```

升级插件不会删除它。建议定期备份该目录。
