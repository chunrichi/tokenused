import * as fs from 'fs';

export interface TranscriptEvent {
  type: string;
  data: any;
  id: string;
  timestamp: string;
  parentId: string | null;
}

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ToolCall {
  toolName: string;
  arguments: string;
  success?: boolean;
  timestamp: string;
}

export interface TranscriptData {
  sessionId: string;
  copilotVersion?: string;
  vscodeVersion?: string;
  messages: TranscriptMessage[];
  toolCalls: ToolCall[];
  startTime?: string;
}

/**
 * Parse a transcripts JSONL file.
 * Extracts user/assistant messages, tool calls, and session metadata.
 */
export function parseTranscriptFile(filePath: string): TranscriptData | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    const messages: TranscriptMessage[] = [];
    const toolCalls: ToolCall[] = [];
    let sessionId = '';
    let copilotVersion: string | undefined;
    let vscodeVersion: string | undefined;
    let startTime: string | undefined;

    for (const line of lines) {
      let event: TranscriptEvent;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      switch (event.type) {
        case 'session.start':
          sessionId = event.data?.sessionId || '';
          copilotVersion = event.data?.copilotVersion;
          vscodeVersion = event.data?.vscodeVersion;
          startTime = event.data?.startTime || event.timestamp;
          break;

        case 'user.message':
          messages.push({
            role: 'user',
            content: extractTextContent(event.data?.content || event.data?.text || ''),
            timestamp: event.timestamp,
          });
          break;

        case 'assistant.message':
          // Extract text content
          const content = extractTextContent(event.data?.content || '');
          if (content) {
            messages.push({
              role: 'assistant',
              content,
              timestamp: event.timestamp,
            });
          }
          // Extract tool requests
          const toolRequests = event.data?.toolRequests;
          if (Array.isArray(toolRequests)) {
            for (const tr of toolRequests) {
              toolCalls.push({
                toolName: tr.name || '',
                arguments: tr.arguments || '',
                timestamp: event.timestamp,
              });
            }
          }
          break;

        case 'tool.execution_complete':
          // Match with existing tool call
          const callId = event.data?.toolCallId;
          const success = event.data?.success;
          if (callId) {
            const existing = toolCalls.find(t => !t.success && t.arguments);
            if (existing && success !== undefined) {
              existing.success = success;
            }
          }
          break;
      }
    }

    return {
      sessionId,
      copilotVersion,
      vscodeVersion,
      messages,
      toolCalls,
      startTime,
    };
  } catch {
    return null;
  }
}

function extractTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text || '')
      .join('\n');
  }
  if (content && typeof content === 'object' && content.text) {
    return content.text;
  }
  return '';
}
