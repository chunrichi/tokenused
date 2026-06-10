import { Database } from '../sqlite-wrapper';

export interface WorkspaceRow {
  id: string;
  folder_path: string;
  workspace_file: string | null;
  name: string | null;
  created_at: number | null;
  last_synced_at: number | null;
}

export function upsertWorkspace(db: Database, ws: WorkspaceRow): void {
  db.prepare(`
    INSERT INTO workspaces (id, folder_path, workspace_file, name, created_at, last_synced_at)
    VALUES (@id, @folder_path, @workspace_file, @name, @created_at, @last_synced_at)
    ON CONFLICT(id) DO UPDATE SET
      folder_path = @folder_path,
      workspace_file = @workspace_file,
      name = @name,
      last_synced_at = @last_synced_at
  `).run(ws);
}

export interface SessionRow {
  session_id: string;
  workspace_id: string;
  model_id: string;
  model_name: string;
  model_family: string;
  model_vendor: string;
  interaction_mode: string;
  copilot_version: string;
  vscode_version: string;
  created_at: number;
  last_active_at: number;
  total_requests: number;
  total_completion_tokens: number;
  total_estimated_input_tokens: number;
  total_elapsed_ms: number;
  file_path: string;
}

export function upsertSession(db: Database, s: SessionRow): void {
  db.prepare(`
    INSERT INTO sessions (
      session_id, workspace_id, model_id, model_name, model_family, model_vendor,
      interaction_mode, copilot_version, vscode_version, created_at, last_active_at,
      total_requests, total_completion_tokens, total_estimated_input_tokens,
      total_elapsed_ms, file_path
    ) VALUES (
      @session_id, @workspace_id, @model_id, @model_name, @model_family, @model_vendor,
      @interaction_mode, @copilot_version, @vscode_version, @created_at, @last_active_at,
      @total_requests, @total_completion_tokens, @total_estimated_input_tokens,
      @total_elapsed_ms, @file_path
    )
    ON CONFLICT(session_id) DO UPDATE SET
      workspace_id = @workspace_id, model_id = @model_id, model_name = @model_name,
      model_family = @model_family, model_vendor = @model_vendor,
      interaction_mode = @interaction_mode, copilot_version = @copilot_version,
      vscode_version = @vscode_version, last_active_at = @last_active_at,
      total_requests = @total_requests, total_completion_tokens = @total_completion_tokens,
      total_estimated_input_tokens = @total_estimated_input_tokens,
      total_elapsed_ms = @total_elapsed_ms
  `).run(s);
}

export interface TokenUsageRow {
  session_id: string;
  request_id: string;
  timestamp: number;
  model_id: string;
  completion_tokens: number;
  estimated_input_tokens: number;
  elapsed_ms: number;
  cost_estimate: number;
}

export function insertTokenUsage(db: Database, rows: TokenUsageRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO token_usage (session_id, request_id, timestamp, model_id,
      completion_tokens, estimated_input_tokens, elapsed_ms, cost_estimate)
    VALUES (@session_id, @request_id, @timestamp, @model_id,
      @completion_tokens, @estimated_input_tokens, @elapsed_ms, @cost_estimate)
  `);
  for (const row of rows) {
    stmt.run(row);
  }
}

export interface ChatContentRow {
  session_id: string;
  role: string;
  content: string;
  timestamp: number;
}

export function insertChatContent(db: Database, rows: ChatContentRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO chat_content (session_id, role, content, timestamp)
    VALUES (@session_id, @role, @content, @timestamp)
  `);
  for (const row of rows) {
    stmt.run(row);
  }
}

export interface ToolUsageRow {
  session_id: string;
  timestamp: number;
  tool_name: string;
  success: number;
}

export function insertToolUsage(db: Database, rows: ToolUsageRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO tool_usage (session_id, timestamp, tool_name, success)
    VALUES (@session_id, @timestamp, @tool_name, @success)
  `);
  for (const row of rows) {
    stmt.run(row);
  }
}

export function deleteSessionData(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM token_usage WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM chat_content WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM tool_usage WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
}
