# Copilot Token Tracker

在 VS Code 中追踪和可视化 GitHub Copilot 的 Token 使用情况。

[English](./README.md)

### 功能特性

- **Token 用量仪表盘** — 查看每日、每周、每月及总计 Token 消耗
- **模型分析** — 查看使用的 Copilot 模型（GPT-4、GPT-3.5 等）
- **费用估算** — 基于 Token 使用量估算 USD 费用
- **使用热力图** — GitHub 风格的热力图展示使用模式
- **自动同步** — 启动时自动同步 Token 数据（可配置间隔）
- **侧边栏摘要** — 在活动栏快速查看 Token 使用情况

### 安装

1. 下载 `copilot-token-tracker-0.1.0.vsix`
2. 运行 `code --install-extension copilot-token-tracker-0.1.0.vsix`

### 命令

| 命令 | 说明 |
|------|------|
| `Copilot Token Tracker: Show Dashboard` | 打开 Token 用量仪表盘 |
| `Copilot Token Tracker: Sync Now` | 手动同步 Token 数据 |

### 配置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `copilotTokenTracker.autoSync` | `true` | 启动时自动同步 |
| `copilotTokenTracker.syncIntervalMinutes` | `30` | 同步间隔（分钟） |
| `copilotTokenTracker.vscodeChannel` | `insiders` | 扫描的 VS Code 频道 |

### 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 监听模式
npm run dev

# 打包 VSIX
npx vsce package
```

### 许可证

MIT
