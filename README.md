# Copilot Token Tracker

Track and visualize your GitHub Copilot token usage in VS Code.

[中文文档](./README.zh.md)

### Features

- **Token Usage Dashboard** — View daily, weekly, monthly, and total token consumption
- **Model Breakdown** — See which Copilot models (GPT-4, GPT-3.5, etc.) you're using
- **Cost Estimation** — Estimate USD costs based on token usage
- **Usage Heatmap** — GitHub-style heatmap showing your activity patterns
- **Auto Sync** — Automatically sync token data on startup (configurable interval)
- **Sidebar Summary** — Quick glance at token usage in the activity bar

### Installation

1. Download `copilot-token-tracker-0.1.0.vsix`
2. Run `code --install-extension copilot-token-tracker-0.1.0.vsix`

### Commands

| Command | Description |
|---------|-------------|
| `Copilot Token Tracker: Show Dashboard` | Open the token usage dashboard |
| `Copilot Token Tracker: Sync Now` | Manually sync token data |

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `copilotTokenTracker.autoSync` | `true` | Auto sync on startup |
| `copilotTokenTracker.syncIntervalMinutes` | `30` | Sync interval (minutes) |
| `copilotTokenTracker.vscodeChannel` | `insiders` | VS Code channel to scan |

### Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Package VSIX
npx vsce package
```

### License

MIT
