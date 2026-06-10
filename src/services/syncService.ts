import * as vscode from 'vscode';
import { Database } from '../database/sqlite-wrapper';
import { getDatabase, runInTransaction } from '../database/db';
import { scanCopilotStorage } from '../core/fileScanner';
import { parseSessionFile } from '../core/sessionParser';
import { parseTranscriptFile } from '../core/transcriptParser';
import { parseModelsJson } from '../core/modelsParser';
import { estimateSessionInputTokens } from '../core/tokenEstimator';
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

      const scanResult = scanCopilotStorage(channel);

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

        // Process sessions
        for (const sessionFile of scanResult.sessions) {
          // Check if already synced (basic check: skip if exists)
          const existing = this.db.prepare(
            'SELECT session_id FROM sessions WHERE session_id = ?'
          ).get(sessionFile.sessionId) as any;
          if (existing) continue; // Skip already synced sessions

          // Parse session file
          const sessionData = parseSessionFile(sessionFile.chatSessionPath);
          if (!sessionData || !sessionData.sessionId) continue;

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

            return {
              session_id: sessionData.sessionId,
              request_id: r.requestId,
              timestamp: r.timestamp,
              model_id: modelId,
              completion_tokens: r.completionTokens,
              estimated_input_tokens: 0, // Will distribute evenly
              elapsed_ms: r.elapsedMs,
              cost_estimate: 0, // Will calculate below
            };
          });

          // Distribute estimated input tokens across requests
          if (tokenRows.length > 0 && estimatedInputTokens > 0) {
            const perRequest = Math.floor(estimatedInputTokens / tokenRows.length);
            for (const row of tokenRows) {
              row.estimated_input_tokens = perRequest;
            }
          }

          // Upsert session
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

          // Insert token usage
          if (tokenRows.length > 0) {
            insertTokenUsage(this.db, tokenRows);
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
        }
      });

      // Refresh daily stats after sync
      refreshDailyStats(this.db);
      this._onSyncComplete.fire();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      this._isSyncing = false;
    }
  }

  dispose(): void {
    this.stopAutoSync();
    this._onSyncComplete.dispose();
  }
}
