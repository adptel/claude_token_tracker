'use strict';

const express = require('express');
const path = require('path');
const { buildAnalytics, CLAUDE_DIR } = require('./parser');

const DEFAULT_PORT = 3737;

async function createServer(options = {}) {
  const app = express();
  const port = options.port || DEFAULT_PORT;
  const dataDir = options.dataDir || CLAUDE_DIR;

  // Serve the static dashboard
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Analytics data API endpoint
  app.get('/api/analytics', async (req, res) => {
    try {
      const data = await buildAnalytics(dataDir);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      resolve({ server, port, url: `http://localhost:${port}` });
    });
    server.on('error', reject);
  });
}

module.exports = { createServer, DEFAULT_PORT };
