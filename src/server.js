'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { buildAnalytics, getSessionDetail, findSessionFiles, CLAUDE_DIR } = require('./parser');

const DEFAULT_PORT = 3737;

async function createServer(options = {}) {
  const app = express();
  const port = options.port || DEFAULT_PORT;
  const dataDir = options.dataDir || CLAUDE_DIR;

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Main analytics endpoint — supports ?start=YYYY-MM-DD&end=YYYY-MM-DD
  app.get('/api/analytics', async (req, res) => {
    try {
      const opts = {};
      if (req.query.start) opts.startDate = req.query.start;
      if (req.query.end) opts.endDate = req.query.end;
      if (req.query.tzOffset) opts.tzOffset = parseInt(req.query.tzOffset, 10);
      const data = await buildAnalytics(dataDir, opts);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Session detail endpoint — returns all turns for a session
  app.get('/api/session/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      // Find the JSONL file for this session
      const files = await findSessionFiles(dataDir);
      const filePath = files.find(f => path.basename(f, '.jsonl') === sessionId);
      if (!filePath) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      const detail = getSessionDetail(filePath);
      res.json({ ok: true, data: detail });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/export', async (req, res) => {
    try {
      const opts = {};
      if (req.query.start) opts.startDate = req.query.start;
      if (req.query.end) opts.endDate = req.query.end;
      if (req.query.tzOffset) opts.tzOffset = parseInt(req.query.tzOffset, 10);
      const data = await buildAnalytics(dataDir, opts);
      const format = req.query.format || 'json';
      if (format === 'csv') {
        const rows = [
          ['Session ID', 'Project', 'First Prompt', 'Client', 'Prompts', 'Messages', 'Tool Calls', 'Total Tokens', 'Cost'].join(','),
          ...data.sessions.map(s => [
            s.sessionId, `"${s.projectName.replace(/"/g, '""')}"`,
            `"${(s.firstPrompt || '').replace(/"/g, '""')}"`, s.client,
            s.totalPrompts || 0, s.messages, s.toolCalls || 0, s.totalTokens, s.cost.toFixed(6),
          ].join(','))
        ].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="claude-sessions.csv"');
        res.send(rows);
      } else {
        res.setHeader('Content-Disposition', 'attachment; filename="claude-analytics.json"');
        res.json(data);
      }
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

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
