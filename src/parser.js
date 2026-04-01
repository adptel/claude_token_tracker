'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { glob } = require('glob');
const { calculateCost } = require('./pricing');

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');

async function findSessionFiles(baseDir = CLAUDE_DIR) {
  if (!fs.existsSync(baseDir)) return [];
  const files = await glob('**/*.jsonl', { cwd: baseDir, absolute: true });
  return files;
}

function parseJsonlFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

function extractProjectName(filePath, baseDir) {
  const rel = path.relative(baseDir, filePath);
  const parts = rel.split(path.sep);
  if (parts.length >= 2) {
    return parts[0]
      .replace(/^-/, '')
      .replace(/-/g, '/')
      .replace(/^\//, '')
      || 'Unknown Project';
  }
  return 'Unknown Project';
}

/**
 * Core aggregation.
 *
 * Key correctness fix: Claude Code can write the same message UUID into multiple
 * JSONL files (when a session is continued / forked). We collect every assistant
 * entry across ALL files first, dedup by UUID (keeping the last-seen entry for
 * each UUID, which has the most complete usage), then aggregate.
 *
 * @param {string} baseDir - path to ~/.claude/projects
 * @param {{ startDate?: string, endDate?: string }} opts - optional date filter (YYYY-MM-DD)
 */
async function buildAnalytics(baseDir = CLAUDE_DIR, opts = {}) {
  const files = await findSessionFiles(baseDir);

  // ── Pass 1: collect every assistant+usage entry, indexed by UUID ──────────
  // Map: uuid -> { entry, sessionId, projectName, filePath }
  const byUuid = new Map();

  // Also collect user messages for prompt lookup
  const userByUuid = new Map();

  // Track which file each UUID was last seen in
  for (const filePath of files) {
    const entries = parseJsonlFile(filePath);
    const sessionId = path.basename(filePath, '.jsonl');
    const projectName = extractProjectName(filePath, baseDir);

    for (const entry of entries) {
      if (!entry.uuid) continue;

      if (entry.type === 'user' && entry.message) {
        // Keep latest version of user message
        userByUuid.set(entry.uuid, entry);
      }

      if (entry.type === 'assistant' && entry.message?.usage) {
        // Overwrite with latest occurrence — this ensures we use the final,
        // complete usage record (streaming may produce earlier partial entries
        // with the same UUID and 0 output_tokens).
        byUuid.set(entry.uuid, { entry, sessionId, projectName, filePath });
      }
    }
  }

  // ── Pass 2: aggregate deduplicated entries ─────────────────────────────────
  const { startDate, endDate } = opts;

  // Per-session accumulators (key = sessionId)
  const sessionMap = new Map();

  const dailyMap = {};
  const modelMap = {};
  const hourlyMap = {};
  const costlyMessages = [];

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheWrite = 0;
  let totalCacheRead = 0;
  let totalCacheReadSavings = 0;
  let totalMessages = 0;

  for (const { entry, sessionId, projectName, filePath } of byUuid.values()) {
    const { usage, model } = entry.message;
    const timestamp = entry.timestamp;
    if (!timestamp) continue;

    // Date range filter
    const date = timestamp.slice(0, 10);
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;

    const costs = calculateCost(usage, model);
    const hour = new Date(timestamp).getUTCHours();

    // Totals
    totalCost += costs.total;
    totalInputTokens += usage.input_tokens || 0;
    totalOutputTokens += usage.output_tokens || 0;
    totalCacheWrite += usage.cache_creation_input_tokens || 0;
    totalCacheRead += usage.cache_read_input_tokens || 0;
    totalCacheReadSavings += costs.cacheReadSavings;
    totalMessages++;

    // Per-session
    if (!sessionMap.has(sessionId)) {
      sessionMap.set(sessionId, {
        sessionId,
        projectName,
        filePath,
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheWrite: 0,
        cacheRead: 0,
        messages: 0,
        firstTimestamp: null,
        lastTimestamp: null,
      });
    }
    const sess = sessionMap.get(sessionId);
    sess.cost += costs.total;
    sess.inputTokens += usage.input_tokens || 0;
    sess.outputTokens += usage.output_tokens || 0;
    sess.cacheWrite += usage.cache_creation_input_tokens || 0;
    sess.cacheRead += usage.cache_read_input_tokens || 0;
    sess.messages++;
    if (!sess.firstTimestamp || timestamp < sess.firstTimestamp) sess.firstTimestamp = timestamp;
    if (!sess.lastTimestamp || timestamp > sess.lastTimestamp) sess.lastTimestamp = timestamp;

    // Daily
    if (!dailyMap[date]) {
      dailyMap[date] = { cost: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, messages: 0, totalTokens: 0 };
    }
    dailyMap[date].cost += costs.total;
    dailyMap[date].inputTokens += usage.input_tokens || 0;
    dailyMap[date].outputTokens += usage.output_tokens || 0;
    dailyMap[date].cacheRead += usage.cache_read_input_tokens || 0;
    dailyMap[date].cacheWrite += usage.cache_creation_input_tokens || 0;
    dailyMap[date].messages++;
    dailyMap[date].totalTokens +=
      (usage.input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.output_tokens || 0);

    // Model
    const modelKey = model || 'unknown';
    if (!modelMap[modelKey]) {
      modelMap[modelKey] = { cost: 0, inputTokens: 0, outputTokens: 0, cacheWrite: 0, cacheRead: 0, messages: 0 };
    }
    modelMap[modelKey].cost += costs.total;
    modelMap[modelKey].inputTokens += usage.input_tokens || 0;
    modelMap[modelKey].outputTokens += usage.output_tokens || 0;
    modelMap[modelKey].cacheWrite += usage.cache_creation_input_tokens || 0;
    modelMap[modelKey].cacheRead += usage.cache_read_input_tokens || 0;
    modelMap[modelKey].messages++;

    // Hourly
    if (!hourlyMap[hour]) hourlyMap[hour] = { cost: 0, messages: 0 };
    hourlyMap[hour].cost += costs.total;
    hourlyMap[hour].messages++;

    // Costly messages — resolve user prompt
    const parentUserEntry = userByUuid.get(entry.parentUuid) || userByUuid.get(entry.uuid);
    let promptSnippet = '';
    if (parentUserEntry?.message?.content) {
      const content = parentUserEntry.message.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.filter(c => c.type === 'text').map(c => c.text).join(' ')
          : '';
      promptSnippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    }

    if (costs.total > 0 || (usage.output_tokens || 0) > 0) {
      costlyMessages.push({
        sessionId,
        projectName,
        timestamp,
        model: modelKey,
        cost: costs.total,
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        cacheWrite: usage.cache_creation_input_tokens || 0,
        cacheRead: usage.cache_read_input_tokens || 0,
        totalTokens:
          (usage.input_tokens || 0) +
          (usage.cache_creation_input_tokens || 0) +
          (usage.cache_read_input_tokens || 0) +
          (usage.output_tokens || 0),
        prompt: promptSnippet,
      });
    }
  }

  // Sort sessions by cost
  const sessions = Array.from(sessionMap.values()).sort((a, b) => b.cost - a.cost);

  // Total tokens (all types) — matches Claude Spend's "TOTAL USAGE" metric
  const totalAllTokens = totalInputTokens + totalCacheWrite + totalCacheRead + totalOutputTokens;

  // Cache hit rate: % of tokens served from cache
  const cacheHitRate = totalAllTokens > 0
    ? Math.round((totalCacheRead / totalAllTokens) * 100)
    : 0;

  costlyMessages.sort((a, b) => b.cost - a.cost);

  const dailySeries = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));

  const modelBreakdown = Object.entries(modelMap)
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([model, data]) => ({ model, ...data }));

  const hourlySeries = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    ...(hourlyMap[h] || { cost: 0, messages: 0 }),
  }));

  const insights = generateInsights({
    sessions,
    dailySeries,
    topMessages: costlyMessages.slice(0, 25),
    totalCost,
    totalMessages,
    totalCacheRead,
    totalCacheReadSavings,
    cacheHitRate,
    totalAllTokens,
    totalOutputTokens,
  });

  return {
    summary: {
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      totalCacheWrite,
      totalCacheRead,
      totalCacheReadSavings,
      totalAllTokens,
      cacheHitRate,
      totalMessages,
      totalSessions: sessions.length,
      totalProjects: new Set(sessions.map(s => s.projectName)).size,
    },
    sessions: sessions.slice(0, 50),
    dailySeries,
    modelBreakdown,
    hourlySeries,
    topMessages: costlyMessages.slice(0, 25),
    insights,
  };
}

function generateInsights({ sessions, dailySeries, topMessages, totalCost, totalMessages,
  totalCacheRead, totalCacheReadSavings, cacheHitRate, totalAllTokens, totalOutputTokens }) {
  const tips = [];

  // Output token ratio
  if (totalAllTokens > 0) {
    const outputPct = ((totalOutputTokens / totalAllTokens) * 100).toFixed(1);
    tips.push({
      icon: '💬',
      title: `${outputPct}% of tokens are Claude actually writing`,
      detail: `The vast majority of your tokens go to input context (what Claude reads), not output (what it writes). Shorter, focused sessions dramatically reduce input costs.`,
    });
  }

  // Cache hit rate
  if (cacheHitRate >= 80) {
    tips.push({
      icon: '💾',
      title: `${cacheHitRate}% cache hit rate — excellent!`,
      detail: `${cacheHitRate}% of your context is served from cache at a fraction of full input price. This is saving you $${totalCacheReadSavings.toFixed(2)}. Keep sessions focused to maintain this.`,
    });
  } else if (totalCacheReadSavings > 0.01) {
    tips.push({
      icon: '💾',
      title: 'Prompt caching is saving you money',
      detail: `You've saved $${totalCacheReadSavings.toFixed(2)} through cache hits. Claude caches repeated context automatically — longer continuous sessions benefit most.`,
    });
  }

  // Long sessions dominate spend
  const top3Cost = sessions.slice(0, 3).reduce((s, x) => s + x.cost, 0);
  if (sessions.length >= 3 && totalCost > 0) {
    const pct = Math.round((top3Cost / totalCost) * 100);
    if (pct >= 50) {
      tips.push({
        icon: '🔥',
        title: 'The longer you chat, the more each message costs',
        detail: `Your 3 costliest sessions account for ${pct}% of total spend. Conversations accumulate context over time — each follow-up message pays to re-read everything. Use /clear to reset.`,
      });
    }
  }

  // Short/vague prompts
  if (topMessages.length > 0) {
    const vague = topMessages.filter(m => m.prompt && m.prompt.length < 20 && m.cost > 0.001);
    if (vague.length > 0) {
      tips.push({
        icon: '⚡',
        title: 'Short, vague messages are costing you the most',
        detail: 'Follow-ups like "yes", "do it", or "continue" force Claude to re-read all prior context to understand what you mean. Starting a new focused session is often cheaper.',
      });
    }
  }

  // Busiest day
  if (dailySeries.length > 0) {
    const busiest = [...dailySeries].sort((a, b) => b.cost - a.cost)[0];
    tips.push({
      icon: '📅',
      title: `Peak day: ${busiest.date}`,
      detail: `You spent $${busiest.cost.toFixed(2)} in a single day with ${busiest.messages} API calls. Pacing heavy work across multiple days helps avoid hitting usage limits.`,
    });
  }

  // Model choice
  tips.push({
    icon: '🧠',
    title: 'Model choice significantly impacts cost',
    detail: 'Opus costs 5× more than Sonnet and 18× more than Haiku per token. Use Haiku or Sonnet for routine tasks; reserve Opus for complex reasoning that truly benefits from it.',
  });

  return tips;
}

module.exports = { buildAnalytics, findSessionFiles, CLAUDE_DIR };
