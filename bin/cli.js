#!/usr/bin/env node
'use strict';

const { createServer } = require('../src/server');
const { CLAUDE_DIR } = require('../src/parser');
const path = require('path');
const fs = require('fs');

const VERSION = require('../package.json').version;

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    console.log(`claude-token-tracker v${VERSION}`);
    process.exit(0);
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
claude-token-tracker v${VERSION}
Track and visualize your Claude Code token usage

Usage:
  npx claude-token-tracker          Start the dashboard (default port 3737)
  npx claude-token-tracker --port <n>  Use a custom port
  npx claude-token-tracker --no-open   Don't open the browser automatically
  npx claude-token-tracker --dir <path> Use a custom Claude data directory

Options:
  -p, --port <n>    Port to listen on (default: 3737)
  --no-open         Don't auto-open browser
  --dir <path>      Path to Claude projects directory (default: ~/.claude/projects)
  -v, --version     Show version
  -h, --help        Show help
`);
    process.exit(0);
  }

  // Parse args
  let port = 3737;
  let shouldOpen = true;
  let dataDir = CLAUDE_DIR;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
      port = parseInt(args[++i], 10);
    }
    if (args[i] === '--no-open') {
      shouldOpen = false;
    }
    if (args[i] === '--dir' && args[i + 1]) {
      dataDir = args[++i];
    }
  }

  // Check if Claude data dir exists
  if (!fs.existsSync(dataDir)) {
    console.warn(`\nWarning: Claude data directory not found: ${dataDir}`);
    console.warn('The dashboard will show empty data.\n');
  }

  console.log(`\nClaude Token Tracker v${VERSION}`);
  console.log('━'.repeat(40));
  console.log(`Data directory: ${dataDir}`);

  let server;
  try {
    const result = await createServer({ port, dataDir });
    server = result.server;
    const url = result.url;

    console.log(`Dashboard: ${url}`);
    console.log('Press Ctrl+C to stop\n');

    if (shouldOpen) {
      const { default: open } = await import('open');
      await open(url);
    }
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nError: Port ${port} is already in use.`);
      console.error(`Try a different port: npx claude-token-tracker --port ${port + 1}\n`);
    } else {
      console.error('\nFailed to start server:', err.message);
    }
    process.exit(1);
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down…');
    server.close(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
