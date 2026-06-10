# VS Code Copilot Token Usage Tracker - Implementation Plan (v2)

## 1. Project Overview

构建一个 VS Code 扩展，用于统计本机上 GitHub Copilot 的使用情况，包括 token 消耗、模型使用分布、趋势分析等，并提供快速检索功能。

### 1.1 核心功能

| 功能 | 描述 |
|------|------|
| **Token 消耗统计** | 读取本地 Copilot session 文件，提取 completionTokens 和估算 inputTokens |
| **可视化报表** | 趋势折线图、**堆叠柱状图**（按模型/项目）、热力图、汇总卡片 |
| **周期筛选** | 支持自定义时间范围（近7天、近30天、自定义日期区间） |
| **模型使用统计** | **堆叠柱状图**：按模型分类统计，支持按项目/workspace/session 钻取 |
| **快速检索** | 通过关键词搜索定位 session 所在的 workspace/项目目录 |
| **本地数据库** | SQLite 存储聚合数据，支持历史趋势分析 |
| **多维度钻取** | 整体 → 项目 → Workspace → Session 四级下钻分析 |
| **工具使用统计** | 统计 Copilot 调用的工具（list_dir、create_file 等）频次 |
| **响应效率分析** | 统计每次请求的 elapsedMs，分析模型响应速度 |
| **Copilot 版本追踪** | 记录不同版本的使用情况和 token 效率变化 |
| **交互模式分析** | 区分 agent/chat/edit 模式的使用分布 |

---

## 2. 数据来源分析

### 2.1 本地存储路径

```
~/Library/Application Support/Code - Insiders/User/
├── workspaceStorage/{WORKSPACE_ID}/
│   ├── chatSessions/{SESSION_ID}.jsonl          # ✅ 主要数据源
│   ├── GitHub.copilot-chat/
│   │   ├── transcripts/{SESSION_ID}.jsonl        # 对话内容
│   │   └── debug-logs/{SESSION_ID}/
│   │       ├── main.jsonl                        # session 生命周期事件
│   │       └── models.json                       # ✅ 模型定价信息
│   └── workspace.json                            # ✅ workspace 路径映射
└── globalStorage/
    ├── storage.json                              # ✅ workspace 备份信息
    └── emptyWindowChatSessions/{SESSION_ID}.jsonl # 空窗口 session
```

### 2.2 可提取的数据字段（基于实际文件探索）

#### chatSessions/*.jsonl（主要数据源，48个文件）

| 数据 | 字段路径 | 类型 | 示例值 |
|------|----------|------|--------|
| **输出 Token 数** | `completionTokens` (kind:1 补丁) | int | 703, 1258, 6073 |
| **请求时间戳** | `timestamp` (kind:2 数组元素) | int | 1780920546117 |
| **处理耗时** | `elapsedMs` (kind:2 数组元素) | int | 32037 (ms) |
| **Session 创建时间** | `creationDate` (kind:0) | int | 1779677207125 |
| **使用的模型 ID** | `selectedModel.identifier` | string | `gcmp.xiaomimimo-token:::mimo-v2.5-token-plan` |
| **模型名称** | `selectedModel.name` | string | `MiMo-V2.5 (TokenPlan)` |
| **模型家族** | `selectedModel.family` | string | `claude-sonnet-4.6` |
| **模型供应商** | `selectedModel.vendor` | string | `gcmp.xiaomimimo` |
| **模型最大输入** | `selectedModel.maxInputTokens` | int | 1000000 |
| **模型最大输出** | `selectedModel.maxOutputTokens` | int | 128000 |
| **交互模式** | `inputState.mode` | object | `{id: "agent", kind: "agent"}` |
| **用户输入文本** | `inputState.inputText` | string | 用户提问内容 |
| **Session ID** | `sessionId` | string | UUID |
| **Agent 扩展 ID** | `agent.extensionId.value` | string | `GitHub.copilot-chat` |
| **请求 ID** | `requestId` | string | `request_xxxxx` |
| **Copilot 版本** | `agent.extensionVersion` | string | `0.52.2026060902` |
| **模型能力** | `selectedModel.capabilities` | object | `{vision, toolCalling, agentMode}` |

#### transcripts/*.jsonl（对话内容与工具使用）

| 数据 | 字段路径 | 示例值 |
|------|----------|--------|
| **对话文本** | `user.message` / `assistant.message` | 用户和 AI 的完整对话 |
| **工具调用名称** | `toolRequests[].name` | `list_dir`, `create_file`, `read_file` |
| **工具调用参数** | `toolRequests[].arguments` | `{path: "/Users/..."}` |
| **推理文本** | `reasoningText` | AI 的内部推理过程 |
| **事件类型** | `type` | 9种：session.start, user.message, assistant.message, assistant.turn_start/end, tool.execution_start/complete |
| **事件时间戳** | `timestamp` | ISO 8601 格式 |
| **Copilot 版本** | `data.copilotVersion` | `0.49.2026051504` |
| **VS Code 版本** | `data.vscodeVersion` | `1.121.0-insider` |

#### debug-logs/models.json（模型定价与能力）

| 数据 | 字段路径 | 示例值 |
|------|----------|--------|
| **模型 ID** | `id` | `claude-opus-4.7` |
| **模型显示名** | `name` | `Claude Opus 4.7` |
| **供应商** | `vendor` | `Anthropic` |
| **计费倍率** | `billing.multiplier` | 15 |
| **是否 Premium** | `billing.is_premium` | true |
| **Tokenizer 类型** | `capabilities.tokenizer` | `o200k_base` |
| **Token 价格** | `billing.token_prices` | 按模型定价 |

#### workspace.json（项目路径映射）

| 数据 | 字段 | 示例值 |
|------|------|--------|
| **项目路径** | `folder` | `file:///Users/lei/Desktop/code/MyToken` |
| **Workspace 文件** | `workspace` | `file:///.../trial.code-workspace` |

**实际映射示例**（来自本机数据）：
| Workspace ID | 项目路径 |
|-------------|----------|
| `49917462...` | `/Users/lei/Desktop/code/MyToken` |
| `862097c1...` | `/Users/lei/Desktop/ai_space/show01` |
| `1da6b2d3...` | `/Users/lei/Desktop/code/test/ZDPF` |
| `33c535ed...` | `/Users/lei/Desktop/code/workspace` |
| `c1444336...` | `/Users/lei/Desktop/ai_space/ai_abap/trial` |

### 2.3 数据限制与解决方案

| 限制 | 解决方案 |
|------|----------|
| ❌ 本地不存储 inputTokens | 使用 `js-tiktoken` 根据对话文本估算（tokenizer 类型从 models.json 获取） |
| ❌ 没有聚合统计 | 构建本地 SQLite 数据库定期聚合 |
| ❌ 无实时拦截 | 后续版本可考虑 HTTP proxy 方式拦截 API 响应 |
| ❌ workspace.json 有两种格式 | 支持 `folder`（单目录）和 `workspace`（.code-workspace 文件）两种映射 |
| ⚠️ JSONL 补丁格式复杂 | 需要实现 kind:0 初始化 + kind:1 补丁合并 + kind:2 数组替换 的完整解析器 |

---

## 3. 技术架构

```
┌─────────────────────────────────────────────────────┐
│                  VS Code Extension                    │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────┐ │
│  │  Data Layer  │───▶│  Service     │───▶│ Webview  │ │
│  │  (SQLite)    │    │  Layer       │    │ (React)  │ │
│  └─────────────┘    └──────────────┘    └──────────┘ │
│        ▲                  │                    │      │
│        │                  ▼                    │      │
│  ┌─────────────┐    ┌──────────────┐          │      │
│  │  File Parser │    │  VS Code API │◀─────────┘      │
│  │  (JSONL)     │    │  (Commands)  │                 │
│  └─────────────┘    └──────────────┘                 │
│        ▲                                              │
│        │                                              │
│  ┌─────────────────────────────────┐                 │
│  │  VS Code Copilot Storage Files  │                 │
│  │  (workspaceStorage / global)    │                 │
│  └─────────────────────────────────┘                 │
└─────────────────────────────────────────────────────┘
```

### 3.1 技术栈

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| **扩展框架** | VS Code Extension API | 标准扩展开发 |
| **数据存储** | `better-sqlite3` | 本地 SQLite 数据库 |
| **前端报表** | Webview + Chart.js / ECharts | 图表渲染 |
| **前端框架** | Vanilla TS 或 Preact | 轻量级 UI |
| **Tokenizer** | `js-tiktoken` | 估算 input tokens |
| **文件解析** | 自定义 JSONL Parser | 解析 session 文件 |
| **搜索** | SQLite FTS5 | 全文搜索对话内容 |

---

## 4. 项目结构

```
vscode-copilot-token-tracker/
├── package.json                    # 扩展清单
├── tsconfig.json
├── webpack.config.js               # Webview 打包配置
├── .vscodeignore
├── src/
│   ├── extension.ts                # 扩展入口
│   ├── constants.ts                # 路径常量
│   │
│   ├── core/
│   │   ├── fileScanner.ts          # 扫描 Copilot 存储文件
│   │   ├── sessionParser.ts        # 解析 JSONL session 文件（kind:0/1/2 补丁合并）
│   │   ├── transcriptParser.ts     # 解析 transcript 文件（对话+工具调用）
│   │   ├── tokenEstimator.ts       # 使用 tiktoken 估算 input tokens
│   │   ├── modelsParser.ts         # 解析 models.json 定价信息
│   │   └── workspaceResolver.ts    # workspace ID → 路径映射
│   │
│   ├── database/
│   │   ├── db.ts                   # SQLite 初始化 & 迁移
│   │   ├── schema.ts               # 数据库表定义
│   │   ├── repositories/
│   │   │   ├── sessionRepo.ts      # Session CRUD
│   │   │   ├── tokenUsageRepo.ts   # Token 用量查询
│   │   │   ├── toolUsageRepo.ts    # 工具调用统计
│   │   │   └── searchRepo.ts       # FTS5 搜索
│   │   └── migrations/
│   │       └── 001_init.ts         # 初始表结构
│   │
│   ├── services/
│   │   ├── syncService.ts          # 定期同步 session 数据到 DB
│   │   ├── analyticsService.ts     # 统计分析（趋势、聚合、热力图、堆叠柱状图）
│   │   ├── drilldownService.ts     # 多维度钻取查询
│   │   └── costCalculator.ts       # 成本计算（基于 token_prices）
│   │
│   ├── webview/
│   │   ├── panel.ts                # Webview View Provider
│   │   ├── messaging.ts            # 消息通信协议
│   │   └── ui/
│   │       ├── index.html          # Webview HTML 入口
│   │       ├── main.ts             # 前端入口
│   │       ├── components/
│   │       │   ├── Dashboard.tsx   # 主面板（汇总卡片）
│   │       │   ├── TrendChart.tsx  # 趋势折线图
│   │       │   ├── HeatMap.tsx     # 使用热力图
│   │       │   ├── StackedBarChart.tsx  # 模型使用堆叠柱状图
│   │       │   ├── DrilldownView.tsx    # 多维度钻取视图
│   │       │   ├── Breadcrumb.tsx       # 面包屑导航
│   │       │   ├── ToolUsageChart.tsx   # 工具调用统计图
│   │       │   ├── SearchPanel.tsx      # 搜索面板
│   │       │   └── TimeRangePicker.tsx  # 时间范围选择器
│   │       └── styles/
│   │           └── main.css
│   │
│   └── utils/
│       ├── pathUtils.ts            # 路径处理工具
│       ├── dateUtils.ts            # 日期处理工具
│       └── formatUtils.ts          # 数字格式化（M/B 单位）
│
├── test/
│   ├── unit/
│   │   ├── sessionParser.test.ts
│   │   ├── transcriptParser.test.ts
│   │   ├── tokenEstimator.test.ts
│   │   └── analyticsService.test.ts
│   └── integration/
│       └── syncService.test.ts
│
└── resources/
    └── icon.svg                    # 扩展图标
```

---

## 5. 数据库 Schema

```sql
-- Workspace 信息
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,              -- workspaceStorage folder ID
    folder_path TEXT NOT NULL,        -- 本地项目路径
    workspace_file TEXT,              -- .code-workspace 文件路径（可选）
    name TEXT,                        -- 项目名称（从路径提取）
    created_at INTEGER,
    last_synced_at INTEGER
);

-- Session 元数据
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id),
    model_id TEXT,                    -- 使用的模型标识
    model_name TEXT,                  -- 模型显示名称
    model_family TEXT,                -- 模型家族 (claude-sonnet-4.6)
    model_vendor TEXT,                -- 模型供应商
    interaction_mode TEXT,            -- 交互模式: agent/chat/edit
    copilot_version TEXT,             -- Copilot 版本号
    vscode_version TEXT,              -- VS Code 版本号
    created_at INTEGER NOT NULL,      -- 创建时间戳
    last_active_at INTEGER,           -- 最后活动时间
    total_requests INTEGER DEFAULT 0, -- 请求数量
    total_completion_tokens INTEGER DEFAULT 0,
    total_estimated_input_tokens INTEGER DEFAULT 0,
    total_elapsed_ms INTEGER DEFAULT 0,
    file_path TEXT,                   -- 原始文件路径
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- 每次请求的 token 使用详情
CREATE TABLE token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    request_id TEXT,
    timestamp INTEGER NOT NULL,
    model_id TEXT,
    completion_tokens INTEGER DEFAULT 0,
    estimated_input_tokens INTEGER DEFAULT 0,
    elapsed_ms INTEGER DEFAULT 0,
    cost_estimate REAL DEFAULT 0,     -- 估算成本（美元）
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- 对话内容（用于全文搜索）
CREATE TABLE chat_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,               -- 'user' | 'assistant'
    content TEXT NOT NULL,
    timestamp INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- FTS5 全文搜索索引
CREATE VIRTUAL TABLE chat_content_fts USING fts5(
    content,
    content=chat_content,
    content_rowid=id
);

-- 工具调用统计
CREATE TABLE tool_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    tool_name TEXT NOT NULL,          -- 'list_dir', 'create_file', 'read_file' 等
    success INTEGER DEFAULT 1,        -- 1=成功, 0=失败
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- 每日聚合统计（加速报表查询）
CREATE TABLE daily_stats (
    date TEXT NOT NULL,               -- 'YYYY-MM-DD'
    model_id TEXT,
    workspace_id TEXT,
    interaction_mode TEXT,            -- agent/chat/edit
    request_count INTEGER DEFAULT 0,
    total_completion_tokens INTEGER DEFAULT 0,
    total_estimated_input_tokens INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0,
    active_sessions INTEGER DEFAULT 0,
    avg_elapsed_ms REAL DEFAULT 0,    -- 平均响应时间
    PRIMARY KEY (date, model_id, workspace_id, interaction_mode)
);
```

---

## 6. 核心模块实现

### 6.1 文件扫描器 (`fileScanner.ts`)

```typescript
// 核心逻辑：扫描所有 Copilot 存储目录
interface ScanResult {
  workspaces: WorkspaceInfo[];
  sessions: SessionFileInfo[];
}

interface WorkspaceInfo {
  storageId: string;     // workspaceStorage 文件夹名
  folderPath: string;    // 本地项目路径
}

interface SessionFileInfo {
  sessionId: string;
  workspaceStorageId: string;
  chatSessionPath: string;    // chatSessions/*.jsonl
  transcriptPath: string;     // transcripts/*.jsonl
  debugLogPath: string;       // debug-logs/*/main.jsonl
  modelsPath: string;         // debug-logs/*/models.json
}

// 扫描流程：
// 1. 读取 globalStorage/storage.json 获取 workspace 备份信息
// 2. 遍历 workspaceStorage/ 下所有文件夹
// 3. 读取 workspace.json 获取本地路径
// 4. 扫描每个 workspace 下的 chatSessions/ 和 GitHub.copilot-chat/
// 5. 同时扫描 emptyWindowChatSessions/
```

### 6.2 Session 解析器 (`sessionParser.ts`)

```typescript
// 解析 JSONL 文件格式（基于实际文件探索确认）
interface SessionData {
  sessionId: string;
  createdAt: number;
  selectedModel: {
    identifier: string;  // e.g. "gcmp.xiaomimimo-token:::mimo-v2.5-token-plan"
    name: string;        // e.g. "MiMo-V2.5 (TokenPlan)"
    family: string;      // e.g. "claude-sonnet-4.6"
    vendor: string;      // e.g. "gcmp.xiaomimimo"
    maxInputTokens: number;
    maxOutputTokens: number;
    capabilities: {
      vision: boolean;
      toolCalling: boolean;
      agentMode: boolean;
    };
  };
  interactionMode: {     // 交互模式
    id: string;          // "agent" | "chat" | "edit"
    kind: string;
  };
  requests: RequestData[];
}

interface RequestData {
  requestId: string;
  timestamp: number;
  completionTokens: number;
  elapsedMs: number;
  agent?: {
    extensionId: { value: string };
    extensionVersion: string;
  };
}

// JSONL 格式（基于实际文件分析）：
// kind:0 → 完整 session 初始化对象（包含 sessionId, creationDate, selectedModel, inputState）
// kind:1 → 路径补丁，格式: { kind:1, k:["requests",0,"completionTokens"], v:703 }
// kind:2 → 数组替换，格式: { kind:2, k:["requests"], v:[...完整请求数组...] }
//
// 解析流程：
// 1. 读取 kind:0 获取初始状态
// 2. 按顺序应用 kind:1 补丁（通过 k 路径定位修改位置）
// 3. kind:2 替换整个数组
// 4. 返回合并后的完整 SessionData
```

### 6.3 Token 估算器 (`tokenEstimator.ts`)

```typescript
import { encoding_for_model } from 'js-tiktoken';

// 根据对话文本估算 input tokens
function estimateInputTokens(messages: string[]): number {
  const enc = encoding_for_model('gpt-4'); // 通用编码器
  let total = 0;
  for (const msg of messages) {
    total += enc.encode(msg).length;
  }
  return total;
}
```

### 6.4 分析服务 (`analyticsService.ts`)

```typescript
interface DashboardData {
  // 汇总卡片
  summary: {
    todayTokens: number;
    weekTokens: number;
    monthTokens: number;
    totalTokens: number;
    activeDays: number;
    peakDay: { date: string; tokens: number };
    totalSessions: number;
    totalRequests: number;
    avgResponseTime: number;  // 平均响应时间 ms
  };
  // 趋势数据
  trend: Array<{
    date: string;
    tokens: number;
    requests: number;
  }>;
  // 热力图数据
  heatmap: Array<{
    date: string;
    dayOfWeek: number;  // 0-6
    week: number;       // 年内第几周
    tokens: number;
  }>;
  // 模型分布（堆叠柱状图数据）
  modelStacked: Array<{
    date: string;          // X 轴日期
    models: Array<{        // 每个模型的 token 数
      modelId: string;
      modelName: string;
      tokens: number;
    }>;
  }>;
  // 工具使用统计
  toolUsage: Array<{
    toolName: string;
    count: number;
    successRate: number;
  }>;
  // 响应效率分布
  responseEfficiency: {
    p50: number;
    p90: number;
    p99: number;
    avg: number;
  };
}

// 钻取查询接口
interface DrilldownQuery {
  level: 'global' | 'project' | 'workspace' | 'session';
  projectId?: string;      // workspace name
  workspaceId?: string;    // workspaceStorage ID
  sessionId?: string;
  dateRange: { start: Date; end: Date };
  groupBy: 'day' | 'week' | 'month';
  stackBy: 'model' | 'project' | 'mode';
}
```

---

## 7. Webview 界面设计

### 7.1 布局结构

```
┌──────────────────────────────────────────────────────────────┐
│  Copilot Token Tracker    [时间范围 ▼] [维度: 整体/项目/workspace/session] [🔄]│
├──────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│ │ 46.93M   │ │ 237.34M  │ │  1.87B   │ │  125天    │         │
│ │ 昨日用量  │ │ 近7天    │ │ 近30天   │ │ 活跃天数  │         │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
├──────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────┐ ┌─────────────────────────────┐  │
│ │   调用趋势图             │ │   调用热力图                 │  │
│ │   (折线图+面积图)        │ │   (日历网格)                │  │
│ │                         │ │   累计: 5.96B               │  │
│ │   [近7天][近30天]       │ │   峰值: 163.58M             │  │
│ └─────────────────────────┘ └─────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────┐ │
│ │  模型使用分布（堆叠柱状图） ── 按 [日/周/月] 分组           │ │
│ │                                                          │ │
│ │  ┌───┐                                                  │ │
│ │  │███│                                                  │ │
│ │  │███│◀─ MiMo-V2.5 (53.2%)                             │ │
│ │  │███├───┐                                              │ │
│ │  │███│▓▓▓│◀─ Claude Sonnet (28.1%)                     │ │
│ │  │███├───┤                                              │ │
│ │  │███│░░░│◀─ GPT-4o (12.4%)                            │ │
│ │  │███├───┤                                              │ │
│ │  │███│▒▒▒│◀─ 其他 (6.3%)                               │ │
│ │  └───┘───┘                                              │ │
│ │  5/20  5/21  5/22  5/23  5/24  5/25  5/26               │ │
│ │                                                          │ │
│ │  [按日] [按周] [按月]    [按模型] [按项目] [按模式]        │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────┐ │
│ │  多维度钻取视图                                            │ │
│ │  ┌────────────────────────────────────────────────────┐  │ │
│ │  │  整体概览 ▸ MyToken ▸ Session: 45a9eb11            │  │ │
│ │  ├────────────────────────────────────────────────────┤  │ │
│ │  │  📂 MyToken (19 sessions, 23.5M tokens)            │  │ │
│ │  │    ├─ Session 45a9eb11  MiMo-V2.5  5.2M  5/25     │  │ │
│ │  │    ├─ Session 637ccb0c  GPT-4o     3.1M  5/24     │  │ │
│ │  │    └─ ...                                          │  │ │
│ │  │  📂 show01 (8 sessions, 12.1M tokens)              │  │ │
│ │  │    ├─ Session f7bacded  Claude     8.3M  5/23      │  │ │
│ │  │    └─ ...                                          │  │ │
│ │  └────────────────────────────────────────────────────┘  │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────┐ │
│ │  🔍 搜索 session / workspace / 关键词                      │ │
│ │  ┌─────────────────────────────────────────────────────┐ │ │
│ │  │ 搜索: "vibe coding"                                  │ │ │
│ │  │ ───────────────────────────────────────────────────  │ │ │
│ │  │ 📂 show01 | Session 45a9eb11 | MiMo-V2.5           │ │ │
│ │  │   "我需要准备一个小的组会，讲解非专业开发人员..."       │ │ │
│ │  │   [📁 打开项目] [📋 复制路径] [📊 查看详情]           │ │ │
│ │  │ ───────────────────────────────────────────────────  │ │ │
│ │  │ 📂 MyToken | Session 637ccb0c | GPT-4o              │ │ │
│ │  │   "帮我实现 token 追踪功能..."                        │ │ │
│ │  │   [📁 打开项目] [📋 复制路径] [📊 查看详情]           │ │ │
│ │  └─────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────┐ │
│ │  附加统计                                                  │ │
│ │  ┌──────────────────────┐  ┌──────────────────────────┐  │ │
│ │  │ 工具调用 TOP 10       │  │ 响应效率分布              │  │ │
│ │  │ create_file  ████████│  │ P50: 18.5s               │  │ │
│ │  │ read_file    ██████  │  │ P90: 42.3s               │  │ │
│ │  │ list_dir     ████    │  │ P99: 58.7s               │  │ │
│ │  │ grep_search  ███     │  │ 平均: 23.1s              │  │ │
│ │  └──────────────────────┘  └──────────────────────────┘  │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 模型使用堆叠柱状图（核心更新）

**设计要点**：
- X 轴：时间维度（日/周/月），由用户选择
- Y 轴：Token 消耗量（M/B 单位自动缩放）
- 每根柱子按不同颜色堆叠，每段代表一个模型
- 鼠标悬浮显示详细数据（模型名、token 数、占比）
- 支持切换维度：按日/周/月 聚合
- 支持切换指标：按模型/项目/交互模式 堆叠

**交互流程**：
1. 默认视图：按日堆叠，按模型分色
2. 点击某一天 → 下钻到该天的项目级别堆叠
3. 点击某个项目 → 下钻到该项目的 session 级别
4. 点击某个 session → 显示该 session 的详细请求列表
5. 面包屑导航支持快速返回上层

### 7.3 多维度钻取设计

```
层级 1: 整体概览
  ├── 所有项目的总 token 消耗（堆叠柱状图：按模型分色）
  ├── 每日趋势折线图
  └── 热力图（日历视图）

层级 2: 项目级别（点击某个项目）
  ├── 该项目下所有 workspace/session 的 token 消耗
  ├── 堆叠柱状图：按模型分色
  └── Session 列表（按 token 消耗排序）

层级 3: Workspace 级别（点击某个 workspace）
  ├── 该 workspace 下所有 session 的 token 消耗
  ├── 堆叠柱状图：按模型分色
  └── Session 列表

层级 4: Session 级别（点击某个 session）
  ├── 每次请求的 token 消耗详情
  ├── 模型信息、交互模式、工具调用记录
  └── 对话内容预览（可搜索定位）
```

### 7.4 搜索功能

```
搜索流程：
1. 用户输入关键词（项目名、session ID、对话内容片段）
2. FTS5 全文搜索 chat_content 表
3. 同时匹配 workspace 名称和路径
4. 返回结果列表，点击可：
   - 复制 workspace 路径
   - 用 VS Code 打开对应文件夹
   - 查看 session 详情
   - 跳转到钻取视图中的对应层级
```

---

## 8. 实现步骤

### Phase 1: 基础框架（Day 1-2）

- [ ] 初始化 VS Code 扩展项目（yo code / 手动搭建）
- [ ] 配置 TypeScript + Webpack
- [ ] 实现文件扫描器 - 扫描所有 Copilot 存储目录
- [ ] 实现 Session JSONL 解析器（kind:0/1/2 补丁合并）
- [ ] 实现 workspace ID → 路径映射（支持 folder 和 workspace 两种格式）

### Phase 2: 数据层（Day 3-4）

- [ ] 设计并创建 SQLite 数据库 Schema（含 tool_usage、daily_stats）
- [ ] 实现同步服务 - 将 session 数据导入 SQLite
- [ ] 实现 token 估算（js-tiktoken，tokenizer 类型从 models.json 获取）
- [ ] 实现模型定价解析（models.json billing.multiplier）
- [ ] 实现成本计算服务
- [ ] 实现 transcript 解析器（提取 user/assistant 消息和工具调用）

### Phase 3: 分析与报表（Day 5-7）

- [ ] 实现 analyticsService - 趋势/热力图/聚合查询
- [ ] 实现堆叠柱状图数据服务（按模型/项目/模式分组）
- [ ] 实现多维度钻取查询（整体→项目→workspace→session）
- [ ] 搭建 Webview 前端框架
- [ ] 实现 Dashboard 汇总卡片
- [ ] 实现趋势折线图（ECharts）
- [ ] 实现使用热力图
- [ ] 实现模型使用**堆叠柱状图**（替代饼图）
- [ ] 实现工具调用统计图
- [ ] 实现响应效率分布图

### Phase 4: 搜索与钻取（Day 8）

- [ ] 实现 FTS5 全文搜索
- [ ] 构建搜索 UI 面板（含对话内容预览）
- [ ] 实现 workspace 快速定位（复制路径/打开文件夹）
- [ ] 实现钻取导航（面包屑 + 层级切换）
- [ ] 实现 Session 详情页（请求列表、工具调用记录）

### Phase 5: 完善与优化（Day 9-10）

- [ ] 添加时间范围选择器
- [ ] 定时自动同步（文件监听或定时器）
- [ ] 性能优化（大数据量场景、增量同步）
- [ ] 打包与发布准备

---

## 9. 关键配置 (package.json)

```json
{
  "name": "copilot-token-tracker",
  "displayName": "Copilot Token Tracker",
  "description": "Track and visualize your GitHub Copilot token usage",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "copilot-token-tracker.showDashboard",
        "title": "Copilot Token Tracker: Show Dashboard"
      },
      {
        "command": "copilot-token-tracker.syncNow",
        "title": "Copilot Token Tracker: Sync Now"
      },
      {
        "command": "copilot-token-tracker.searchSessions",
        "title": "Copilot Token Tracker: Search Sessions"
      }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "copilot-token-tracker",
          "title": "Copilot Token Tracker",
          "icon": "$(graph)"
        }
      ]
    },
    "views": {
      "copilot-token-tracker": [
        {
          "type": "webview",
          "id": "copilot-token-tracker.dashboard",
          "name": "Token Usage Dashboard"
        }
      ]
    },
    "configuration": {
      "title": "Copilot Token Tracker",
      "properties": {
        "copilotTokenTracker.autoSync": {
          "type": "boolean",
          "default": true,
          "description": "Automatically sync token data on startup"
        },
        "copilotTokenTracker.syncIntervalMinutes": {
          "type": "number",
          "default": 30,
          "description": "Sync interval in minutes"
        },
        "copilotTokenTracker.vscodeChannel": {
          "type": "string",
          "enum": ["stable", "insiders"],
          "default": "insiders",
          "description": "VS Code channel to scan"
        }
      }
    }
  }
}
```

---

## 10. 参考资源

| 资源 | 链接 | 用途 |
|------|------|------|
| VS Code Extension API | https://code.visualstudio.com/api | 扩展开发文档 |
| Webview API | https://code.visualstudio.com/api/extension-guides/webview | 仪表盘 UI |
| better-sqlite3 | https://github.com/WiseLibs/better-sqlite3 | 本地数据库 |
| js-tiktoken | https://github.com/nicobailon/js-tiktoken | Token 估算 |
| ECharts | https://echarts.apache.org/ | 图表渲染 |
| GitHub Copilot SDK | https://github.com/github/copilot-sdk | 了解 token 数据格式 |
| GitHub Copilot Metrics API | https://docs.github.com/en/rest/copilot/copilot-usage-metrics | 企业级指标参考 |

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| VS Code 存储格式变更 | 解析失败 | 使用健壮的 JSONL 解析器，添加版本检测 |
| 大量 session 文件导致性能问题 | 启动慢 | 增量同步 + SQLite 缓存，只处理新增/变更文件 |
| input token 估算不准确 | 成本偏差 | 标注为"估算值"，后续可通过 API 拦截获取精确值 |
| 跨平台路径差异 | Windows/Linux 兼容性 | 使用 `os.homedir()` + 平台检测 |
| Webview 安全性 | XSS 风险 | 使用 CSP 策略，不使用 innerHTML |
