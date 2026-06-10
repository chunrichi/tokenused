import { Database } from '../sqlite-wrapper';

export interface DailyStatsRow {
  date: string;
  model_id: string;
  workspace_id: string;
  interaction_mode: string;
  request_count: number;
  total_completion_tokens: number;
  total_estimated_input_tokens: number;
  total_cost: number;
  active_sessions: number;
  avg_elapsed_ms: number;
}

export function refreshDailyStats(db: Database): void {
  // Rebuild daily_stats from token_usage + sessions
  db.exec('DELETE FROM daily_stats');
  db.exec(`
    INSERT INTO daily_stats (date, model_id, workspace_id, interaction_mode,
      request_count, total_completion_tokens, total_estimated_input_tokens,
      total_cost, active_sessions, avg_elapsed_ms)
    SELECT
      strftime('%Y-%m-%d', tu.timestamp / 1000, 'unixepoch', 'localtime') as date,
      COALESCE(tu.model_id, '') as model_id,
      COALESCE(s.workspace_id, '') as workspace_id,
      COALESCE(s.interaction_mode, '') as interaction_mode,
      COUNT(*) as request_count,
      SUM(tu.completion_tokens) as total_completion_tokens,
      SUM(tu.estimated_input_tokens) as total_estimated_input_tokens,
      SUM(tu.cost_estimate) as total_cost,
      COUNT(DISTINCT tu.session_id) as active_sessions,
      AVG(tu.elapsed_ms) as avg_elapsed_ms
    FROM token_usage tu
    JOIN sessions s ON tu.session_id = s.session_id
    GROUP BY date, tu.model_id, s.workspace_id, s.interaction_mode
  `);
}

export interface SummaryData {
  todayTokens: number;
  weekTokens: number;
  monthTokens: number;
  totalTokens: number;
  activeDays: number;
  totalSessions: number;
  totalRequests: number;
  avgResponseTime: number;
}

export function getSummary(db: Database): SummaryData {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN date = strftime('%Y-%m-%d', 'now', 'localtime') THEN total_completion_tokens + total_estimated_input_tokens ELSE 0 END), 0) as todayTokens,
      COALESCE(SUM(CASE WHEN date >= strftime('%Y-%m-%d', 'now', '-6 days', 'localtime') THEN total_completion_tokens + total_estimated_input_tokens ELSE 0 END), 0) as weekTokens,
      COALESCE(SUM(CASE WHEN date >= strftime('%Y-%m-%d', 'now', '-29 days', 'localtime') THEN total_completion_tokens + total_estimated_input_tokens ELSE 0 END), 0) as monthTokens,
      COALESCE(SUM(total_completion_tokens + total_estimated_input_tokens), 0) as totalTokens,
      COUNT(DISTINCT date) as activeDays
    FROM daily_stats
  `).get() as any;

  const sessionRow = db.prepare(`
    SELECT COUNT(*) as totalSessions, SUM(total_requests) as totalRequests,
           AVG(CASE WHEN total_requests > 0 THEN total_elapsed_ms * 1.0 / total_requests ELSE 0 END) as avgResponseTime
    FROM sessions
  `).get() as any;

  return {
    todayTokens: row?.todayTokens || 0,
    weekTokens: row?.weekTokens || 0,
    monthTokens: row?.monthTokens || 0,
    totalTokens: row?.totalTokens || 0,
    activeDays: row?.activeDays || 0,
    totalSessions: sessionRow?.totalSessions || 0,
    totalRequests: sessionRow?.totalRequests || 0,
    avgResponseTime: sessionRow?.avgResponseTime || 0,
  };
}

export interface TrendPoint {
  date: string;
  completionTokens: number;
  estimatedInputTokens: number;
  requests: number;
}

export function getTrend(db: Database, startDate: string, endDate: string): TrendPoint[] {
  const rows = db.prepare(`
    SELECT date,
           SUM(total_completion_tokens) as completionTokens,
           SUM(total_estimated_input_tokens) as estimatedInputTokens,
           SUM(request_count) as requests
    FROM daily_stats
    WHERE date >= ? AND date <= ?
    GROUP BY date
    ORDER BY date
  `).all(startDate, endDate) as TrendPoint[];

  // Fill in missing dates with zero values
  const dataMap = new Map<string, TrendPoint>();
  for (const row of rows) dataMap.set(row.date, row);

  const result: TrendPoint[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    result.push(dataMap.get(ds) || { date: ds, completionTokens: 0, estimatedInputTokens: 0, requests: 0 });
  }
  return result;
}

export interface ModelStackedPoint {
  date: string;
  model_id: string;
  model_name: string;
  tokens: number;
}

export function getModelStackedData(db: Database, startDate: string, endDate: string): ModelStackedPoint[] {
  return db.prepare(`
    SELECT ds.date,
           ds.model_id,
           COALESCE(s.model_name, ds.model_id) as model_name,
           SUM(ds.total_completion_tokens + ds.total_estimated_input_tokens) as tokens
    FROM daily_stats ds
    LEFT JOIN sessions s ON ds.model_id = s.model_id
    WHERE ds.date >= ? AND ds.date <= ?
    GROUP BY ds.date, ds.model_id
    ORDER BY ds.date, tokens DESC
  `).all(startDate, endDate) as ModelStackedPoint[];
}

export interface ToolUsageRow {
  tool_name: string;
  count: number;
  success_count: number;
}

export function getToolUsageStats(db: Database, startDate?: string, endDate?: string): ToolUsageRow[] {
  let sql = `SELECT tool_name, COUNT(*) as count, SUM(success) as success_count FROM tool_usage`;
  const params: string[] = [];
  if (startDate && endDate) {
    sql += ` WHERE strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch', 'localtime') >= ? AND strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch', 'localtime') <= ?`;
    params.push(startDate, endDate);
  }
  sql += ` GROUP BY tool_name ORDER BY count DESC LIMIT 15`;
  return db.prepare(sql).all(...params) as ToolUsageRow[];
}

export interface HeatmapPoint {
  date: string;
  tokens: number;
}

export function getHeatmapData(db: Database, startDate: string, endDate: string): HeatmapPoint[] {
  const rows = db.prepare(`
    SELECT date, SUM(total_completion_tokens + total_estimated_input_tokens) as tokens
    FROM daily_stats
    WHERE date >= ? AND date <= ?
    GROUP BY date
    ORDER BY date
  `).all(startDate, endDate) as HeatmapPoint[];

  const dataMap = new Map<string, HeatmapPoint>();
  for (const row of rows) dataMap.set(row.date, row);

  const result: HeatmapPoint[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    result.push(dataMap.get(ds) || { date: ds, tokens: 0 });
  }
  return result;
}

export interface ModelBreakdownRow {
  model_id: string;
  model_name: string;
  request_count: number;
  total_tokens: number;
}

export function getModelBreakdown(db: Database, startDate?: string, endDate?: string): ModelBreakdownRow[] {
  let sql = `SELECT ds.model_id, COALESCE(s.model_name, ds.model_id) as model_name,
    SUM(ds.request_count) as request_count,
    SUM(ds.total_completion_tokens + ds.total_estimated_input_tokens) as total_tokens
    FROM daily_stats ds LEFT JOIN sessions s ON ds.model_id = s.model_id`;
  const params: string[] = [];
  if (startDate && endDate) {
    sql += ` WHERE ds.date >= ? AND ds.date <= ?`;
    params.push(startDate, endDate);
  }
  sql += ` GROUP BY ds.model_id ORDER BY total_tokens DESC`;
  return db.prepare(sql).all(...params) as ModelBreakdownRow[];
}
