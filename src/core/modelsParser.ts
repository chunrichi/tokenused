import * as fs from 'fs';

export interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
  family: string;
  billingMultiplier: number;
  isPremium: boolean;
  tokenizer: string;
  maxContextWindow: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsToolCalls: boolean;
}

/**
 * Parse models.json from debug-logs directory
 */
export function parseModelsJson(filePath: string): ModelInfo[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const models = JSON.parse(raw);
    if (!Array.isArray(models)) return [];

    return models.map((m: any) => ({
      id: m.id || '',
      name: m.name || m.id || '',
      vendor: m.vendor || '',
      family: m.capabilities?.family || '',
      billingMultiplier: m.billing?.multiplier ?? 1,
      isPremium: m.billing?.is_premium ?? false,
      tokenizer: m.capabilities?.tokenizer || '',
      maxContextWindow: m.capabilities?.limits?.max_context_window_tokens || 0,
      maxOutputTokens: m.capabilities?.limits?.max_output_tokens || 0,
      supportsVision: m.capabilities?.supports?.vision ?? false,
      supportsToolCalls: m.capabilities?.supports?.tool_calls ?? false,
    }));
  } catch {
    return [];
  }
}
