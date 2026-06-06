'use strict';

// Pricing per 1 million tokens (USD)
// Sources: Anthropic pricing page (as of 2026-06)
// Cache writes: 25% premium over input; cache reads: 10% of input price
const MODEL_PRICING = {
  // Claude Opus 4.x — $5/1M input, $25/1M output
  'claude-opus-4-8': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50,
  },
  'claude-opus-4-7': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50,
  },
  'claude-opus-4-6': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50,
  },
  'claude-opus-4-5': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50,
  },
  'claude-opus-4': {
    input: 5.0,
    output: 25.0,
    cacheWrite: 6.25,
    cacheRead: 0.50,
  },
  // Claude Sonnet 4.x — $3/1M input, $15/1M output
  'claude-sonnet-4-6': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.30,
  },
  'claude-sonnet-4-5': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.30,
  },
  'claude-sonnet-4': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.30,
  },
  // Claude Haiku 4.x — $1/1M input, $5/1M output
  'claude-haiku-4-5': {
    input: 1.0,
    output: 5.0,
    cacheWrite: 1.25,
    cacheRead: 0.10,
  },
  'claude-haiku-4': {
    input: 1.0,
    output: 5.0,
    cacheWrite: 1.25,
    cacheRead: 0.10,
  },
  // Claude 3.5 Haiku — $0.80/1M input, $4/1M output
  'claude-haiku-3-5': {
    input: 0.80,
    output: 4.0,
    cacheWrite: 1.00,
    cacheRead: 0.08,
  },
  // Claude 3 family
  'claude-3-opus': {
    input: 15.0,
    output: 75.0,
    cacheWrite: 18.75,
    cacheRead: 1.50,
  },
  'claude-3-sonnet': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.30,
  },
  'claude-3-haiku': {
    input: 0.25,
    output: 1.25,
    cacheWrite: 0.30,
    cacheRead: 0.03,
  },
};

const DEFAULT_PRICING = {
  input: 3.0,
  output: 15.0,
  cacheWrite: 3.75,
  cacheRead: 0.30,
};

/**
 * Returns the pricing config for a given model ID.
 * Matches by longest prefix to handle versioned model IDs.
 */
function getPricing(modelId) {
  if (!modelId) return DEFAULT_PRICING;
  const lower = modelId.toLowerCase();
  // Try longest matching key first
  let best = null;
  let bestLen = 0;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (lower.includes(key) && key.length > bestLen) {
      best = MODEL_PRICING[key];
      bestLen = key.length;
    }
  }
  return best || DEFAULT_PRICING;
}

/**
 * Calculates cost in USD for a given usage object and model.
 */
function calculateCost(usage, modelId) {
  const pricing = getPricing(modelId);
  const M = 1_000_000;

  const inputCost = ((usage.input_tokens || 0) / M) * pricing.input;
  const outputCost = ((usage.output_tokens || 0) / M) * pricing.output;
  const cacheWriteCost = ((usage.cache_creation_input_tokens || 0) / M) * pricing.cacheWrite;
  const cacheReadCost = ((usage.cache_read_input_tokens || 0) / M) * pricing.cacheRead;

  // Cache savings: what cache_read would have cost at full input price minus what was paid
  const cacheReadSavings =
    ((usage.cache_read_input_tokens || 0) / M) * (pricing.input - pricing.cacheRead);

  return {
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    total: inputCost + outputCost + cacheWriteCost + cacheReadCost,
    cacheReadSavings,
  };
}

module.exports = { getPricing, calculateCost, MODEL_PRICING };
