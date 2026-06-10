import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getWorkspaceStoragePath, getEmptyWindowSessionsPath, CHAT_SESSIONS_DIR, TRANSCRIPTS_DIR, DEBUG_LOGS_DIR } from '../constants';

export interface WorkspaceInfo {
  storageId: string;
  folderPath: string;
  workspaceFile?: string;
}

export interface SessionFileInfo {
  sessionId: string;
  workspaceStorageId: string;
  chatSessionPath: string;
  transcriptPath?: string;
  debugLogPath?: string;
  modelsPath?: string;
}

export interface ScanResult {
  workspaces: WorkspaceInfo[];
  sessions: SessionFileInfo[];
}

export function scanCopilotStorage(channel: 'stable' | 'insiders' = 'insiders'): ScanResult {
  const wsStoragePath = getWorkspaceStoragePath(channel);
  const emptyPath = getEmptyWindowSessionsPath(channel);
  const workspaces: WorkspaceInfo[] = [];
  const sessions: SessionFileInfo[] = [];

  // Scan workspaceStorage directories
  if (fs.existsSync(wsStoragePath)) {
    const entries = fs.readdirSync(wsStoragePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const storageId = entry.name;
      const wsDir = path.join(wsStoragePath, storageId);

      // Read workspace.json to get folder path
      const wsJsonPath = path.join(wsDir, 'workspace.json');
      let folderPath = '';
      let workspaceFile: string | undefined;
      if (fs.existsSync(wsJsonPath)) {
        try {
          const wsJson = JSON.parse(fs.readFileSync(wsJsonPath, 'utf-8'));
          if (wsJson.folder) {
            folderPath = decodeURIComponent(wsJson.folder.replace('file://', ''));
          } else if (wsJson.workspace) {
            workspaceFile = decodeURIComponent(wsJson.workspace.replace('file://', ''));
            folderPath = path.dirname(workspaceFile);
          }
        } catch { /* ignore parse errors */ }
      }

      if (folderPath) {
        workspaces.push({ storageId, folderPath, workspaceFile });
      }

      // Scan chatSessions
      const chatSessionsDir = path.join(wsDir, CHAT_SESSIONS_DIR);
      if (fs.existsSync(chatSessionsDir)) {
        const chatFiles = fs.readdirSync(chatSessionsDir).filter(f => f.endsWith('.jsonl'));
        for (const chatFile of chatFiles) {
          const sessionId = chatFile.replace('.jsonl', '');
          const chatSessionPath = path.join(chatSessionsDir, chatFile);

          // Look for matching transcript
          const transcriptPath = path.join(wsDir, TRANSCRIPTS_DIR, `${sessionId}.jsonl`);
          const actualTranscript = fs.existsSync(transcriptPath) ? transcriptPath : undefined;

          // Look for debug-logs
          const debugLogDir = path.join(wsDir, DEBUG_LOGS_DIR, sessionId);
          let debugLogPath: string | undefined;
          let modelsPath: string | undefined;
          if (fs.existsSync(debugLogDir)) {
            const mainJsonl = path.join(debugLogDir, 'main.jsonl');
            const modelsJson = path.join(debugLogDir, 'models.json');
            if (fs.existsSync(mainJsonl)) debugLogPath = mainJsonl;
            if (fs.existsSync(modelsJson)) modelsPath = modelsJson;
          }

          sessions.push({
            sessionId,
            workspaceStorageId: storageId,
            chatSessionPath,
            transcriptPath: actualTranscript,
            debugLogPath,
            modelsPath
          });
        }
      }
    }
  }

  // Scan empty window sessions
  if (fs.existsSync(emptyPath)) {
    const emptyFiles = fs.readdirSync(emptyPath).filter(f => f.endsWith('.jsonl'));
    for (const f of emptyFiles) {
      const sessionId = f.replace('.jsonl', '');
      sessions.push({
        sessionId,
        workspaceStorageId: '__empty__',
        chatSessionPath: path.join(emptyPath, f)
      });
    }
  }

  // Add empty workspace entry
  if (!workspaces.find(w => w.storageId === '__empty__')) {
    workspaces.push({ storageId: '__empty__', folderPath: '(No Workspace)' });
  }

  return { workspaces, sessions };
}
