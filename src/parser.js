'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { glob } = require('glob');
const { calculateCost } = require('./pricing');

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Discovers all JSONL session files under ~/.claude/projects/
 */
async function findSessionFiles(baseDir = CLAUDE_DIR) {
  if (!fs.existsSync(baseDir)) return [];
  const files = await glob('**/*.jsonl', { cwd: baseDir, absolute: true });
  return files;
}

/**
 * Parses a single JSONL file and returns an array of parsed lines.
 */
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

/**
 * Extracts the project name from a file path.
 * ~/.claude/projects/<project-dir>/<session-id>.jsonl
 */
function extractProjectName(filePath) {
  const rel = path.relative(CLAUDE_DIR, filePath);
  const parts = rel.split(path.sep);
  if (parts.length >= 2) {
    // Convert directory slug back to a readable name
    return parts[0]
      .replace(/^-/, '')
      .replace(/-/g, '/')
      .replace(/^\//, '')
      || 'Unknown Project';
  }
  return 'Unknown Project';
}

/**
 * Core aggregation: reads all session files and builds a full analytics dataset.
 */
async function buildAnalytics(baseDir = CLAUDE_DIR) {
  const files = await findSessionFiles(baseDir);

  const sessions = [];        // one entry per JSONL file
  const dailyMap = {};        // date -> {cost, inputTokens, outputTokens, cacheRead, cacheWrite, messages}
  const modelMap = {};        // model -> {cost, inputTokens, outputTokens, messages}
  const hourlyMap = {};       // hour (0-23) -> {cost, messages}
  const costlyMessages = [];  // top messages by cost

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheWrite = 0;
  let totalCacheRead = 0;
  let totalCacheReadSavings = 0;
  let totalMessages = 0;

  for (const filePath of files) {
    const entries = parseJsonlFile(filePath);
    const sessionId = path.basename(filePath, '.jsonl');
    const projectName = extractProjectName(filePath);

    let sessionCost = 0;
    let sessionInputTokens = 0;
    let sessionOutputTokens = 0;
    let sessionCacheWrite = 0;
    let sessionCacheRead = 0;
    let sessionMessages = 0;
    let sessionFirstTs = null;
    let sessionLastTs = null;

    // Collect user messages keyed by uuid for pairing with assistant responses
    const userMessages = {};

    for (const entry of entries) {
      if (entry.type === 'user' && entry.message) {
        userMessages[entry.uuid] = entry;
      }

      if (entry.type === 'assistant' && entry.message?.usage) {
        const { usage, model } = entry.message;
        const timestamp = entry.timestamp;

        if (!timestamp) continue;

        const costs = calculateCost(usage, model);
        const date = timestamp.slice(0, 10); // YYYY-MM-DD
        const hour = new Date(timestamp).getUTCHours();

        // Accumulate totals
        sessionCost += costs.total;
        sessionInputTokens += usage.input_tokens || 0;
        sessionOutputTokens += usage.output_tokens || 0;
        sessionCacheWrite += usage.cache_creation_input_tokens || 0;
        sessionCacheRead += usage.cache_read_input_tokens || 0;
        sessionMessages++;

        totalCost += costs.total;
        totalInputTokens += usage.input_tokens || 0;
        totalOutputTokens += usage.output_tokens || 0;
        totalCacheWrite += usage.cache_creation_input_tokens || 0;
        totalCacheRead += usage.cache_read_input_tokens || 0;
        totalCacheReadSavings += costs.cacheReadSavings;
        totalMessages++;

        if (!sessionFirstTs || timestamp < sessionFirstTs) sessionFirstTs = timestamp;
        if (!sessionLastTs || timestamp > sessionLastTs) sessionLastTs = timestamp;

        // Daily aggregation
        if (!dailyMap[date]) {
          dailyMap[date] = { cost: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, messages: 0 };
        }
        dailyMap[date].cost += costs.total;
        dailyMap[date].inputTokens += usage.input_tokens || 0;
        dailyMap[date].outputTokens += usage.output_tokens || 0;
        dailyMap[date].cacheRead += usage.cache_read_input_tokens || 0;
        dailyMap[date].cacheWrite += usage.cache_creation_input_tokens || 0;
        dailyMap[date].messages++;

        // Model aggregation
        const modelKey = model || 'unknown';
        if (!modelMap[modelKey]) {
          modelMap[modelKey] = { cost: 0, inputTokens: 0, outputTokens: 0, messages: 0 };
        }
        modelMap[modelKey].cost += costs.total;
        modelMap[modelKey].inputTokens += usage.input_tokens || 0;
        modelMap[modelKey].outputTokens += usage.output_tokens || 0;
        modelMap[modelKey].messages++;

        // Hourly aggregation
        if (!hourlyMap[hour]) {
          hourlyMap[hour] = { cost: 0, messages: 0 };
        }
        hourlyMap[hour].cost += costs.total;
        hourlyMap[hour].messages++;

        // Track costly messages - find the user prompt that preceded this
        const parentUserEntry = userMessages[entry.parentUuid] || userMessages[entry.uuid];
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

        if (costs.total > 0 || usage.output_tokens > 0) {
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
            prompt: promptSnippet,
          });
        }
      }
    }

    if (sessionMessages > 0) {
      sessions.push({
        sessionId,
        projectName,
        filePath,
        cost: sessionCost,
        inputTokens: sessionInputTokens,
        outputTokens: sessionOutputTokens,
        cacheWrite: sessionCacheWrite,
        cacheRead: sessionCacheRead,
        messages: sessionMessages,
        firstTimestamp: sessionFirstTs,
        lastTimestamp: sessionLastTs,
      });
    }
  }

  // Sort sessions by cost descending
  sessions.sort((a, b) => b.cost - a.cost);

  // Top 25 costliest messages
  costlyMessages.sort((a, b) => b.cost - a.cost);
  const topMessages = costlyMessages.slice(0, 25);

  // Build daily series sorted by date
  const dailySeries = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));

  // Build model breakdown array
  const modelBreakdown = Object.entries(modelMap)
    .sort(([, a], [, b]) => b.cost - a.cost)
    .map(([model, data]) => ({ model, ...data }));

  // Build hourly array (0-23)
  const hourlySeries = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    ...(hourlyMap[h] || { cost: 0, messages: 0 }),
  }));

  // Insights
  const insights = generateInsights({
    sessions,
    dailySeries,
    topMessages,
    totalCost,
    totalMessages,
    totalCacheRead,
    totalCacheReadSavings,
  });

  return {
    summary: {
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      totalCacheWrite,
      totalCacheRead,
      totalCacheReadSavings,
      totalMessages,
      totalSessions: sessions.length,
      totalProjects: new Set(sessions.map(s => s.projectName)).size,
    },
    sessions: sessions.slice(0, 50),
    dailySeries,
    modelBreakdown,
    hourlySeries,
    topMessages,
    insights,
  };
}

function generateInsights({ sessions, dailySeries, topMessages, totalCost, totalMessages, totalCacheRead, totalCacheReadSavings }) {
  const tips = [];

  // Long sessions insight
  const top3SessionsCost = sessions.slice(0, 3).reduce((s, x) => s + x.cost, 0);
  if (sessions.length >= 3 && totalCost > 0) {
    const pct = Math.round((top3SessionsCost / totalCost) * 100);
    if (pct >= 50) {
      tips.push({
        icon: '🔥',
        title: 'Top 3 sessions dominate your spend',
        detail: `Your 3 most expensive sessions account for ${pct}% of all spending. Long conversations accumulate context, driving up input tokens. Use /clear to reset context mid-session.`,
      });
    }
  }

  // Cache savings insight
  if (totalCacheReadSavings > 0.01) {
    tips.push({
      icon: '💾',
      title: 'Prompt caching is saving you money',
      detail: `You've saved $${totalCacheReadSavings.toFixed(4)} through cache hits. Claude automatically caches repeated context — keeping sessions focused helps maximize this.`,
    });
  }

  // Busiest day
  if (dailySeries.length > 0) {
    const busiest = [...dailySeries].sort((a, b) => b.cost - a.cost)[0];
    tips.push({
      icon: '📅',
      title: `Highest spend day: ${busiest.date}`,
      detail: `You spent $${busiest.cost.toFixed(4)} in a single day with ${busiest.messages} messages. Consider spreading heavy work across sessions to stay within limits.`,
    });
  }

  // Short/vague prompts
  if (topMessages.length > 0) {
    const vague = topMessages.filter(m => m.prompt && m.prompt.length < 20 && m.cost > 0.001);
    if (vague.length > 0) {
      tips.push({
        icon: '⚡',
        title: 'Short prompts can be costly',
        detail: `Short follow-ups like "yes", "do it", or "continue" force Claude to re-read all prior context. Starting a new session with a clear prompt is often more efficient.`,
      });
    }
  }

  // General tip about models
  tips.push({
    icon: '🧠',
    title: 'Model choice significantly impacts cost',
    detail: 'Opus is 5x more expensive than Sonnet and 18x more than Haiku. Use Haiku or Sonnet for routine tasks, and reserve Opus for complex reasoning.',
  });

  return tips;
}

module.exports = { buildAnalytics, findSessionFiles, CLAUDE_DIR };
