export const SCHEMA_SQL = `
-- Workspace information
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    folder_path TEXT NOT NULL,
    workspace_file TEXT,
    name TEXT,
    created_at INTEGER,
    last_synced_at INTEGER
);

-- Session metadata
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    workspace_id TEXT,
    model_id TEXT,
    model_name TEXT,
    model_family TEXT,
    model_vendor TEXT,
    interaction_mode TEXT,
    copilot_version TEXT,
    vscode_version TEXT,
    created_at INTEGER NOT NULL,
    last_active_at INTEGER,
    total_requests INTEGER DEFAULT 0,
    total_completion_tokens INTEGER DEFAULT 0,
    total_estimated_input_tokens INTEGER DEFAULT 0,
    total_elapsed_ms INTEGER DEFAULT 0,
    file_path TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Per-request token usage
CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    request_id TEXT,
    timestamp INTEGER NOT NULL,
    model_id TEXT,
    completion_tokens INTEGER DEFAULT 0,
    estimated_input_tokens INTEGER DEFAULT 0,
    elapsed_ms INTEGER DEFAULT 0,
    cost_estimate REAL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Chat content for full-text search
CREATE TABLE IF NOT EXISTS chat_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Tool usage tracking
CREATE TABLE IF NOT EXISTS tool_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    tool_name TEXT NOT NULL,
    success INTEGER DEFAULT 1,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Daily aggregated stats
CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT NOT NULL,
    model_id TEXT NOT NULL DEFAULT '',
    workspace_id TEXT NOT NULL DEFAULT '',
    interaction_mode TEXT NOT NULL DEFAULT '',
    request_count INTEGER DEFAULT 0,
    total_completion_tokens INTEGER DEFAULT 0,
    total_estimated_input_tokens INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0,
    active_sessions INTEGER DEFAULT 0,
    avg_elapsed_ms REAL DEFAULT 0,
    PRIMARY KEY (date, model_id, workspace_id, interaction_mode)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_model ON sessions(model_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_usage_session ON tool_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
`;

export const CLEAR_SQL = `
DELETE FROM daily_stats;
DELETE FROM tool_usage;
DELETE FROM token_usage;
DELETE FROM chat_content;
DELETE FROM sessions;
DELETE FROM workspaces;
`;
