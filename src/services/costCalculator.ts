/**
 * Cost calculation based on model billing multipliers.
 * Base pricing: roughly $3 per 1M input tokens, $15 per 1M output tokens (varies by model).
 * These are estimates for display purposes.
 */

const BASE_INPUT_PRICE_PER_M = 3.0;   // $3 per 1M input tokens
const BASE_OUTPUT_PRICE_PER_M = 15.0; // $15 per 1M output tokens

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  billingMultiplier: number = 1
): number {
  const inputCost = (inputTokens / 1_000_000) * BASE_INPUT_PRICE_PER_M * billingMultiplier;
  const outputCost = (outputTokens / 1_000_000) * BASE_OUTPUT_PRICE_PER_M * billingMultiplier;
  return inputCost + outputCost;
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
}
