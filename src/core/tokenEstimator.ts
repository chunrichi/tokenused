/**
 * Simple token estimator.
 * Since we don't have the exact tokenizer, we use a heuristic:
 * - For English: ~4 chars per token
 * - For CJK (Chinese/Japanese/Korean): ~1.5 chars per token
 * This gives a rough but useful estimate.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  let cjkCount = 0;
  let otherCount = 0;

  for (const char of text) {
    const code = char.charCodeAt(0);
    // CJK Unified Ideographs: 0x4E00-0x9FFF
    // CJK Extension A: 0x3400-0x4DBF
    // Hiragana/Katakana: 0x3040-0x30FF
    // Hangul: 0xAC00-0xD7AF
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x3040 && code <= 0x30FF) ||
      (code >= 0xAC00 && code <= 0xD7AF)
    ) {
      cjkCount++;
    } else {
      otherCount++;
    }
  }

  // CJK: ~1.5 chars per token, English: ~4 chars per token
  return Math.ceil(cjkCount / 1.5 + otherCount / 4);
}

/**
 * Estimate input tokens for a session based on all messages.
 */
export function estimateSessionInputTokens(messages: string[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg);
  }
  return total;
}
