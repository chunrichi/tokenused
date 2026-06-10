import { Database } from '../sqlite-wrapper';

export interface SearchResult {
  session_id: string;
  workspace_id: string;
  workspace_path: string;
  workspace_name: string;
  model_id: string;
  model_name: string;
  snippet: string;
  role: string;
  created_at: number;
}

export function searchChatContent(db: Database, query: string, limit: number = 20): SearchResult[] {
  // Use FTS5 for full-text search
  const rows = db.prepare(`
    SELECT
      cc.session_id,
      s.workspace_id,
      COALESCE(w.folder_path, '') as workspace_path,
      COALESCE(w.name, '') as workspace_name,
      COALESCE(s.model_id, '') as model_id,
      COALESCE(s.model_name, '') as model_name,
      snippet(chat_content_fts, 0, '<b>', '</b>', '...', 32) as snippet,
      cc.role,
      s.created_at
    FROM chat_content_fts
    JOIN chat_content cc ON chat_content_fts.rowid = cc.id
    JOIN sessions s ON cc.session_id = s.session_id
    LEFT JOIN workspaces w ON s.workspace_id = w.id
    WHERE chat_content_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as SearchResult[];

  return rows;
}

export function searchWorkspaces(db: Database, query: string): Array<{ id: string; folder_path: string; name: string }> {
  return db.prepare(`
    SELECT id, folder_path, COALESCE(name, '') as name
    FROM workspaces
    WHERE folder_path LIKE ? OR name LIKE ? OR id LIKE ?
    LIMIT 20
  `).all(`%${query}%`, `%${query}%`, `%${query}%`) as Array<{ id: string; folder_path: string; name: string }>;
}
