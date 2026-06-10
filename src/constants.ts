import * as os from 'os';
import * as path from 'path';

// VS Code storage paths
function getVsCodeBasePath(channel: 'stable' | 'insiders' = 'insiders'): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return channel === 'insiders'
        ? path.join(home, 'Library', 'Application Support', 'Code - Insiders')
        : path.join(home, 'Library', 'Application Support', 'Code');
    case 'linux':
      return channel === 'insiders'
        ? path.join(home, '.config', 'Code - Insiders')
        : path.join(home, '.config', 'Code');
    case 'win32':
      return channel === 'insiders'
        ? path.join(home, 'AppData', 'Roaming', 'Code - Insiders')
        : path.join(home, 'AppData', 'Roaming', 'Code');
    default:
      return channel === 'insiders'
        ? path.join(home, '.config', 'Code - Insiders')
        : path.join(home, '.config', 'Code');
  }
}

export function getUserDataPath(channel: 'stable' | 'insiders' = 'insiders'): string {
  return path.join(getVsCodeBasePath(channel), 'User');
}

export function getWorkspaceStoragePath(channel: 'stable' | 'insiders' = 'insiders'): string {
  return path.join(getUserDataPath(channel), 'workspaceStorage');
}

export function getGlobalStoragePath(channel: 'stable' | 'insiders' = 'insiders'): string {
  return path.join(getUserDataPath(channel), 'globalStorage');
}

export function getEmptyWindowSessionsPath(channel: 'stable' | 'insiders' = 'insiders'): string {
  return path.join(getGlobalStoragePath(channel), 'emptyWindowChatSessions');
}

// DB path in extension global storage
export const DB_NAME = 'copilot-token-tracker.db';
export const CHAT_SESSIONS_DIR = 'chatSessions';
export const TRANSCRIPTS_DIR = 'GitHub.copilot-chat/transcripts';
export const DEBUG_LOGS_DIR = 'GitHub.copilot-chat/debug-logs';
