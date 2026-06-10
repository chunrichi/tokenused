import * as fs from 'fs';

export interface SessionData {
  sessionId: string;
  createdAt: number;
  selectedModel?: {
    identifier: string;
    name: string;
    family: string;
    vendor: string;
    maxInputTokens: number;
    maxOutputTokens: number;
  };
  interactionMode?: { id: string; kind: string };
  copilotVersion?: string;
  vscodeVersion?: string;
  requests: RequestData[];
}

export interface RequestData {
  requestId: string;
  timestamp: number;
  completionTokens: number;
  elapsedMs: number;
  agentExtensionId?: string;
  agentExtensionVersion?: string;
}

/**
 * Parse a chatSessions JSONL file with kind:0/1/2 patch format.
 */
export function parseSessionFile(filePath: string): SessionData | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    let state: any = null;

    for (const line of lines) {
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.kind === 0) {
        // Initial state
        state = entry.v;
      } else if (entry.kind === 1 && state) {
        // Patch: apply value at path k
        applyPatch(state, entry.k, entry.v);
      } else if (entry.kind === 2 && state) {
        // Array replacement at path k
        setAtPath(state, entry.k, entry.v);
      }
    }

    if (!state) return null;

    const requests: RequestData[] = [];
    if (Array.isArray(state.requests)) {
      for (const r of state.requests) {
        requests.push({
          requestId: r.requestId || '',
          timestamp: r.timestamp || 0,
          completionTokens: r.completionTokens || 0,
          elapsedMs: r.elapsedMs || 0,
          agentExtensionId: r.agent?.extensionId?.value || r.agent?.extensionId || undefined,
          agentExtensionVersion: r.agent?.extensionVersion || undefined,
        });
      }
    }

    const model = state.selectedModel || state.inputState?.selectedModel;
    const mode = state.inputState?.mode;

    return {
      sessionId: state.sessionId || '',
      createdAt: state.creationDate || 0,
      selectedModel: model ? {
        identifier: model.identifier || model.id || '',
        name: model.name || model.identifier || model.id || '',
        family: model.family || '',
        vendor: model.vendor || '',
        maxInputTokens: model.maxInputTokens || 0,
        maxOutputTokens: model.maxOutputTokens || 0,
      } : undefined,
      interactionMode: mode ? { id: mode.id || '', kind: mode.kind || '' } : undefined,
      copilotVersion: undefined, // filled from transcript if available
      vscodeVersion: undefined,
      requests,
    };
  } catch {
    return null;
  }
}

function applyPatch(obj: any, path: (string | number)[], value: any): void {
  if (path.length === 0) return;
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (current == null) return;
    if (typeof key === 'number') {
      if (!Array.isArray(current)) return;
      current = current[key];
    } else {
      if (current[key] === undefined) current[key] = {};
      current = current[key];
    }
  }
  const lastKey = path[path.length - 1];
  if (current != null) {
    current[lastKey] = value;
  }
}

function setAtPath(obj: any, path: (string | number)[], value: any): void {
  applyPatch(obj, path, value);
}
