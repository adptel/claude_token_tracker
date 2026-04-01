# Claude Token Tracker

A local analytics dashboard for your Claude Code token usage and spend. Reads your session data directly from disk — nothing is sent anywhere.

## Quick Start

```bash
npx claude-token-tracker
```

Opens a dashboard at `http://localhost:3737` in your browser.

## Features

- **Overview** — Total spend, input/output tokens, cache savings summary cards with a daily spend chart and hourly activity heatmap
- **Sessions** — All conversations ranked by cost with per-session token breakdown
- **Costly Queries** — Top 25 most expensive individual messages with the prompt text, model, and token details
- **Models** — Doughnut chart and table showing spend split by Claude model (Opus / Sonnet / Haiku)
- **Insights** — Automatically generated tips based on your actual usage patterns

## How it works

Claude Code stores every session as JSONL files in `~/.claude/projects/`. This tool reads those files locally, parses the `usage` field from each assistant message, applies current model pricing, and serves an analytics dashboard — all on your machine.

## Options

```
npx claude-token-tracker [options]

Options:
  -p, --port <n>    Port (default: 3737)
  --no-open         Don't auto-open browser
  --dir <path>      Custom Claude data directory (default: ~/.claude/projects)
  -v, --version     Version
  -h, --help        Help
```

## Pricing

Approximate rates used for cost calculation (per 1M tokens):

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| Opus 4.x | $15 | $75 | $18.75 | $1.50 |
| Sonnet 4.x | $3 | $15 | $3.75 | $0.30 |
| Haiku 4.x/3.5 | $0.80 | $4 | $1.00 | $0.08 |

## Local development

```bash
git clone https://github.com/adptel/claude_token_tracker
cd claude_token_tracker
npm install
npm start
```

## Privacy

All data stays on your machine. The server only binds to `127.0.0.1` (localhost). No telemetry, no analytics, no external requests (except loading Chart.js and fonts from CDN for the dashboard UI).

## License

MIT
