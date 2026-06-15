import * as vscode from 'vscode';
import { Database } from '../database/sqlite-wrapper';
import { getDatabase, runInTransaction } from '../database/db';
import { scanCopilotStorage } from '../core/fileScanner';
import { parseSessionFile } from '../core/sessionParser';
import { parseTranscriptFile } from '../core/transcriptParser';
import { parseModelsJson } from '../core/modelsParser';
import { estimateSessionInputTokens } from '../core/tokenEstimator';
import { estimateCost } from './costCalculator';
import { extractProjectName } from '../utils/formatUtils';
import {
  upsertWorkspace, upsertSession, insertTokenUsage,
  insertChatContent, insertToolUsage, deleteSessionData
} from '../database/repositories/dataRepo';
import { refreshDailyStats } from '../database/repositories/analyticsRepo';

export class SyncService {
  private db!: Database;
  private syncInterval: NodeJS.Timeout | undefined;
  private _isSyncing = false;
  private _onSyncComplete = new vscode.EventEmitter<void>();
  public readonly onSyncComplete = this._onSyncComplete.event;
  private _initPromise: Promise<void>;

  constructor(context: vscode.ExtensionContext) {
    this._initPromise = this.init(context);
  }

  private async init(context: vscode.ExtensionContext): Promise<void> {
    this.db = await getDatabase(context);
  }

  get isSyncing(): boolean {
    return this._isSyncing;
  }

  async startAutoSync(intervalMinutes: number): Promise<void> {
    this.stopAutoSync();
    await this._initPromise;
    console.log('[TokenTracker] Starting auto sync');
    // Sync immediately
    this.sync();
    // Then sync periodically
    this.syncInterval = setInterval(() => {
      this.sync();
    }, intervalMinutes * 60 * 1000);
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
  }

  async sync(): Promise<void> {
    if (this._isSyncing) return;
    this._isSyncing = true;
    await this._initPromise;

    try {
      const config = vscode.workspace.getConfiguration('copilotTokenTracker');
      const channel = config.get<'stable' | 'insiders'>('vscodeChannel', 'insiders');

      console.log(`[TokenTracker] sync() called, channel=${channel}, db=${!!this.db}, dbPath=${(this.db as any).dbPath || 'unknown'}`);
      const scanResult = scanCopilotStorage(channel);
      console.log(`[TokenTracker] Scan: ${scanResult.workspaces.length} workspaces, ${scanResult.sessions.length} sessions`);

      let processedSessions = 0;
      let skippedExisting = 0;
      let skippedParseFail = 0;
      let errorCount = 0;
      let updatedSessions = 0;

      runInTransaction(() => {
        // Upsert workspaces
        for (const ws of scanResult.workspaces) {
          upsertWorkspace(this.db, {
            id: ws.storageId,
            folder_path: ws.folderPath,
            workspace_file: ws.workspaceFile || null,
            name: extractProjectName(ws.folderPath),
            created_at: null,
            last_synced_at: Date.now(),
          });
        }

        console.log(`[TokenTracker] Upserted ${scanResult.workspaces.length} workspaces, processing ${scanResult.sessions.length} sessions...`);

        // Process sessions
        for (const sessionFile of scanResult.sessions) {
          // Parse session file first to check request count
          let sessionData;
          try {
            sessionData = parseSessionFile(sessionFile.chatSessionPath);
          } catch (e: any) {
            console.error(`[TokenTracker] Parse error for ${sessionFile.sessionId}: ${e.message}`);
            errorCount++;
            continue;
          }
          if (!sessionData || !sessionData.sessionId) { skippedParseFail++; continue; }

          // Check if already synced - skip only if request count AND tokens haven't changed
          const existing = this.db.prepare(
            'SELECT session_id, total_requests, total_completion_tokens FROM sessions WHERE session_id = ?'
          ).get(sessionFile.sessionId) as any;
          const newTotalCompletion = sessionData.requests.reduce((s, r) => s + r.completionTokens, 0);
          if (existing && existing.total_requests >= sessionData.requests.length && existing.total_completion_tokens >= newTotalCompletion) { skippedExisting++; continue; }

          // If updating, delete old data first
          if (existing) {
            deleteSessionData(this.db, sessionFile.sessionId);
            updatedSessions++;
          }

          console.log(`[TokenTracker] Session ${sessionFile.sessionId.slice(0, 8)}: ${sessionData.requests.length} requests, model=${sessionData.selectedModel?.identifier || 'none'}`);

          // Parse transcript for messages and tool calls
          let transcriptData = sessionFile.transcriptPath
            ? parseTranscriptFile(sessionFile.transcriptPath)
            : null;

          // Parse models.json for pricing data
          let modelPricing: Record<string, number> = {};
          if (sessionFile.modelsPath) {
            const models = parseModelsJson(sessionFile.modelsPath);
            for (const m of models) {
              modelPricing[m.id] = m.billingMultiplier;
            }
          }

          // Estimate input tokens from transcript messages
          const inputMessages = transcriptData?.messages.map(m => m.content) || [];
          const estimatedInputTokens = estimateSessionInputTokens(inputMessages);

          // Get model info
          const modelId = sessionData.selectedModel?.identifier || '';
          const billingMultiplier = modelPricing[modelId] || 1;

          // Calculate totals
          let totalCompletion = 0;
          let totalElapsed = 0;
          let lastActiveAt = 0;

          const tokenRows = sessionData.requests.map(r => {
            totalCompletion += r.completionTokens;
            totalElapsed += r.elapsedMs;
            if (r.timestamp > lastActiveAt) lastActiveAt = r.timestamp;

            // Use per-request modelId if available, fallback to session model
            const reqModelId = r.modelId || modelId;
            const reqBilling = modelPricing[reqModelId] || 1;

            return {
              session_id: sessionData.sessionId,
              request_id: r.requestId,
              timestamp: r.timestamp,
              model_id: reqModelId,
              completion_tokens: r.completionTokens,
              estimated_input_tokens: 0,
              elapsed_ms: r.elapsedMs,
              cost_estimate: 0,
              _billingMultiplier: reqBilling,
            };
          });

          // Distribute estimated input tokens across requests
          if (tokenRows.length > 0 && estimatedInputTokens > 0) {
            const perRequest = Math.floor(estimatedInputTokens / tokenRows.length);
            for (const row of tokenRows) {
              row.estimated_input_tokens = perRequest;
            }
          }

          // Calculate cost estimates using per-request billing
          for (const row of tokenRows) {
            row.cost_estimate = estimateCost(row.estimated_input_tokens, row.completion_tokens, row._billingMultiplier);
          }

          // Clean up internal billing field before DB insert
          const cleanTokenRows = tokenRows.map(({ _billingMultiplier, ...rest }) => rest);

          // Upsert session
          try {
            upsertSession(this.db, {
              session_id: sessionData.sessionId,
              workspace_id: sessionFile.workspaceStorageId,
              model_id: modelId,
              model_name: sessionData.selectedModel?.name || '',
              model_family: sessionData.selectedModel?.family || '',
              model_vendor: sessionData.selectedModel?.vendor || '',
              interaction_mode: sessionData.interactionMode?.id || '',
              copilot_version: transcriptData?.copilotVersion || '',
              vscode_version: transcriptData?.vscodeVersion || '',
              created_at: sessionData.createdAt,
              last_active_at: lastActiveAt || sessionData.createdAt,
              total_requests: sessionData.requests.length,
              total_completion_tokens: totalCompletion,
              total_estimated_input_tokens: estimatedInputTokens,
              total_elapsed_ms: totalElapsed,
              file_path: sessionFile.chatSessionPath,
            });
          } catch (e: any) {
            console.error(`[TokenTracker] DB error upserting session ${sessionFile.sessionId}: ${e.message}`);
            errorCount++;
            continue;
          }

          // Insert token usage
          if (cleanTokenRows.length > 0) {
            insertTokenUsage(this.db, cleanTokenRows);
          }

          // Insert chat content from transcript
          if (transcriptData && transcriptData.messages.length > 0) {
            const chatRows = transcriptData.messages.map(m => ({
              session_id: sessionData.sessionId,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.timestamp).getTime(),
            }));
            insertChatContent(this.db, chatRows);
          }

          // Insert tool usage from transcript
          if (transcriptData && transcriptData.toolCalls.length > 0) {
            const toolRows = transcriptData.toolCalls.map(t => ({
              session_id: sessionData.sessionId,
              timestamp: new Date(t.timestamp).getTime(),
              tool_name: t.toolName,
              success: t.success ? 1 : 0,
            }));
            insertToolUsage(this.db, toolRows);
          }

          processedSessions++;
        }
      });

      // Save immediately after transaction to ensure data persistence
      this.db.save();

      // Refresh daily stats after sync
      try {
        refreshDailyStats(this.db);
        this.db.save(); // Save daily_stats changes too
      } catch (e) {
        console.error('[TokenTracker] refreshDailyStats failed:', e);
      }

      this._onSyncComplete.fire();

      // Check DB state after sync
      const sessionCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM sessions').get() as any)?.cnt || 0;
      const tokenCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM token_usage').get() as any)?.cnt || 0;
      const msg = `Sync: ${processedSessions} new, ${updatedSessions} updated, ${skippedExisting} skipped, ${skippedParseFail} fail | DB: ${sessionCount} sessions, ${tokenCount} tokens`;
      console.log(`[TokenTracker] ${msg}`);
      vscode.window.showInformationMessage(`Token Tracker: ${msg}`);

    } catch (err) {
      console.error('[TokenTracker] Sync failed:', err);
      vscode.window.showErrorMessage(`Token Tracker sync failed: ${err}`);
    } finally {
      this._isSyncing = false;
    }
  }

  dispose(): void {
    this.stopAutoSync();
    this._onSyncComplete.dispose();
  }
}
