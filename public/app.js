'use strict';

// ===== State =====
let analyticsData = null;
let dailyChart = null;
let hourlyChart = null;
let modelPieChart = null;
let currentSection = 'overview';
let activeDateRange = 7; // days; 0 = all time

// ===== Formatting helpers =====
function fmt$(n) {
  if (n === undefined || n === null) return '$0.00';
  if (n < 0.0001) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(5)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function fmtShortDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function shortModelName(model) {
  if (!model) return 'unknown';
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  return model.split('-').slice(0, 3).join('-');
}

function modelClass(model) {
  if (!model) return '';
  if (model.includes('opus')) return 'model-opus';
  if (model.includes('sonnet')) return 'model-sonnet';
  if (model.includes('haiku')) return 'model-haiku';
  return '';
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== Chart defaults =====
Chart.defaults.color = '#888898';
Chart.defaults.borderColor = '#2a2a30';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size = 12;

function chartTooltipConfig() {
  return {
    backgroundColor: '#1a1a1e',
    borderColor: '#2a2a30',
    borderWidth: 1,
    titleColor: '#e8e8ed',
    bodyColor: '#888898',
    padding: 10,
    cornerRadius: 6,
  };
}

// ===== Render functions =====
function renderSummaryCards(summary) {
  document.getElementById('total-cost').textContent = fmt$(summary.totalCost);
  document.getElementById('total-all-tokens').textContent = fmtTokens(summary.totalAllTokens);
  document.getElementById('cache-hit-rate').textContent = `${summary.cacheHitRate}%`;
  document.getElementById('cache-savings').textContent = fmt$(summary.totalCacheReadSavings);

  document.getElementById('total-messages-sub').textContent =
    `${summary.totalMessages.toLocaleString()} messages`;
  document.getElementById('total-token-breakdown').textContent =
    `${fmtTokens(summary.totalInputTokens)} input · ${fmtTokens(summary.totalCacheWrite)} cache w · ${fmtTokens(summary.totalOutputTokens)} output`;
  document.getElementById('cache-read-sub').textContent =
    `${fmtTokens(summary.totalCacheRead)} tokens from cache`;
  document.getElementById('total-sessions-sub').textContent =
    `${summary.totalSessions} sessions · ${summary.totalProjects} projects`;
}

function renderDailyChart(dailySeries) {
  const ctx = document.getElementById('daily-chart').getContext('2d');
  if (dailyChart) dailyChart.destroy();

  const labels = dailySeries.map(d => d.date);
  const costs = dailySeries.map(d => d.cost);
  const outputs = dailySeries.map(d => d.outputTokens);

  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Cost ($)',
          data: costs,
          backgroundColor: 'rgba(217, 119, 6, 0.7)',
          borderColor: '#d97706',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          label: 'Output Tokens',
          data: outputs,
          type: 'line',
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.08)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#3b82f6',
          tension: 0.3,
          fill: true,
          yAxisID: 'y2',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartTooltipConfig(),
          callbacks: {
            label: (ctx) => {
              if (ctx.datasetIndex === 0) return ` Cost: ${fmt$(ctx.parsed.y)}`;
              return ` Output: ${fmtTokens(ctx.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: '#1e1e24' },
          ticks: { maxRotation: 45, font: { size: 11 } },
        },
        y: {
          type: 'linear',
          position: 'left',
          grid: { color: '#1e1e24' },
          ticks: {
            callback: (v) => fmt$(v),
            font: { size: 11 },
          },
        },
        y2: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            callback: (v) => fmtTokens(v),
            font: { size: 11 },
          },
        },
      },
    },
  });
}

function renderHourlyChart(hourlySeries) {
  const ctx = document.getElementById('hourly-chart').getContext('2d');
  if (hourlyChart) hourlyChart.destroy();

  const labels = hourlySeries.map(h => `${String(h.hour).padStart(2, '0')}:00`);
  const messages = hourlySeries.map(h => h.messages);
  const costs = hourlySeries.map(h => h.cost);

  const maxMsg = Math.max(...messages, 1);
  const bgColors = messages.map(m => {
    const intensity = m / maxMsg;
    return `rgba(217, 119, 6, ${0.1 + intensity * 0.8})`;
  });

  hourlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Messages',
        data: messages,
        backgroundColor: bgColors,
        borderColor: 'transparent',
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartTooltipConfig(),
          callbacks: {
            label: (ctx) => {
              const hour = ctx.dataIndex;
              const cost = costs[hour];
              return [` ${ctx.parsed.y} messages`, ` Cost: ${fmt$(cost)}`];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, maxRotation: 0 },
        },
        y: {
          grid: { color: '#1e1e24' },
          ticks: { font: { size: 11 }, stepSize: 1 },
        },
      },
    },
  });
}

function renderSessionsTable(sessions) {
  const tbody = document.getElementById('sessions-tbody');
  if (!sessions || sessions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="empty-state">
        <div class="empty-state-icon">📂</div>
        <h3>No sessions found</h3>
        <p>No Claude Code sessions detected in ~/.claude/projects/</p>
      </div>
    </td></tr>`;
    return;
  }

  const maxCost = Math.max(...sessions.map(s => s.cost), 0.0001);

  tbody.innerHTML = sessions.map((s, i) => {
    const barW = Math.round((s.cost / maxCost) * 80);
    return `
      <tr>
        <td><span class="project-badge" title="${escapeHtml(s.projectName)}">${escapeHtml(s.projectName)}</span></td>
        <td class="mono">${escapeHtml(s.sessionId.slice(0, 8))}…</td>
        <td class="num">${s.messages}</td>
        <td class="num">${fmtTokens(s.inputTokens)}</td>
        <td class="num">${fmtTokens(s.outputTokens)}</td>
        <td class="num">${fmtTokens(s.cacheRead)}</td>
        <td>
          <div class="cost-bar-wrap">
            <div class="cost-bar" style="width:${barW}px"></div>
            <span style="font-family:'JetBrains Mono',monospace;color:var(--accent-light);font-size:0.82rem">${fmt$(s.cost)}</span>
          </div>
        </td>
        <td style="color:var(--text-dim);font-size:0.78rem">${fmtShortDate(s.lastTimestamp)}</td>
      </tr>
    `;
  }).join('');
}

function renderTopMessages(messages) {
  const container = document.getElementById('messages-list');
  if (!messages || messages.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">💬</div>
      <h3>No messages yet</h3>
      <p>Your costliest queries will appear here.</p>
    </div>`;
    return;
  }

  container.innerHTML = messages.map((m, i) => {
    const prompt = m.prompt
      ? `<div class="message-prompt">${escapeHtml(m.prompt)}${m.prompt.length >= 200 ? '…' : ''}</div>`
      : `<div class="message-prompt empty">[ No user prompt captured ]</div>`;

    return `
      <div class="message-card">
        <div class="message-rank">
          <span>#${i + 1} · ${fmtDate(m.timestamp)}</span>
          <span class="message-cost-badge">${fmt$(m.cost)}</span>
        </div>
        ${prompt}
        <div class="message-meta">
          <span><span class="meta-label">Model:</span> <span class="model-pill ${modelClass(m.model)}">${shortModelName(m.model)}</span></span>
          <span><span class="meta-label">Input:</span> ${fmtTokens(m.inputTokens)}</span>
          <span><span class="meta-label">Output:</span> ${fmtTokens(m.outputTokens)}</span>
          <span><span class="meta-label">Cache R:</span> ${fmtTokens(m.cacheRead)}</span>
          <span><span class="meta-label">Project:</span> <span style="color:var(--text-muted)">${escapeHtml(m.projectName)}</span></span>
        </div>
      </div>
    `;
  }).join('');
}

function renderModelChart(modelBreakdown) {
  const ctx = document.getElementById('model-pie-chart').getContext('2d');
  if (modelPieChart) modelPieChart.destroy();

  if (!modelBreakdown || modelBreakdown.length === 0) return;

  const COLORS = ['#d97706', '#3b82f6', '#22c55e', '#a78bfa', '#f43f5e', '#06b6d4'];

  modelPieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: modelBreakdown.map(m => shortModelName(m.model)),
      datasets: [{
        data: modelBreakdown.map(m => m.cost),
        backgroundColor: COLORS.slice(0, modelBreakdown.length),
        borderColor: '#141416',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 16, font: { size: 12 }, color: '#888898' },
        },
        tooltip: {
          ...chartTooltipConfig(),
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return ` ${fmt$(ctx.parsed)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function renderModelTable(modelBreakdown, totalCost) {
  const tbody = document.getElementById('model-tbody');
  if (!modelBreakdown || modelBreakdown.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:20px">No data</td></tr>';
    return;
  }

  tbody.innerHTML = modelBreakdown.map(m => {
    const pct = totalCost > 0 ? ((m.cost / totalCost) * 100).toFixed(1) : '0.0';
    return `
      <tr>
        <td>
          <span class="model-pill ${modelClass(m.model)}">${shortModelName(m.model)}</span>
          <span style="margin-left:6px;font-size:0.75rem;color:var(--text-dim)">${escapeHtml(m.model)}</span>
        </td>
        <td class="num">${m.messages.toLocaleString()}</td>
        <td class="num">${fmtTokens(m.inputTokens)}</td>
        <td class="num">${fmtTokens(m.outputTokens)}</td>
        <td class="cost">${fmt$(m.cost)}</td>
        <td class="right">
          <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
            <div style="width:60px;height:4px;border-radius:2px;background:var(--bg3);overflow:hidden">
              <div style="height:100%;width:${Math.min(100, parseFloat(pct))}%;background:var(--accent);border-radius:2px"></div>
            </div>
            <span style="font-size:0.78rem;color:var(--text-muted)">${pct}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderInsights(insights) {
  const grid = document.getElementById('insights-grid');
  if (!insights || insights.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted)">No insights available yet. Keep using Claude Code!</p>';
    return;
  }
  grid.innerHTML = insights.map(tip => `
    <div class="insight-card">
      <div class="insight-icon">${tip.icon}</div>
      <div class="insight-title">${escapeHtml(tip.title)}</div>
      <div class="insight-detail">${escapeHtml(tip.detail)}</div>
    </div>
  `).join('');
}

// ===== Date range helpers =====
function getDateRange(days) {
  if (days === 0) return { start: null, end: null };
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function updateDateLabel(days) {
  const label = document.getElementById('date-range-label');
  if (days === 0) {
    label.textContent = 'All time';
    return;
  }
  const { start, end } = getDateRange(days);
  const fmt = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  label.textContent = `${fmt(start)} – ${fmt(end)}`;
}

// ===== Data loading =====
async function loadData() {
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.classList.add('spinning');

  try {
    const { start, end } = getDateRange(activeDateRange);
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);

    const res = await fetch('/api/analytics?' + params.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Unknown error');
    analyticsData = json.data;
    renderAll(analyticsData);
    updateDateLabel(activeDateRange);
    document.getElementById('last-updated').textContent =
      `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error('Failed to load analytics:', err);
    document.getElementById('last-updated').textContent = 'Error loading data';
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

function renderAll(data) {
  renderSummaryCards(data.summary);
  renderDailyChart(data.dailySeries);
  renderHourlyChart(data.hourlySeries);
  renderSessionsTable(data.sessions);
  renderTopMessages(data.topMessages);
  renderModelChart(data.modelBreakdown);
  renderModelTable(data.modelBreakdown, data.summary.totalCost);
  renderInsights(data.insights);
}

// ===== Navigation =====
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const section = document.getElementById(name);
  if (section) section.style.display = 'block';
  const navItem = document.querySelector(`[data-section="${name}"]`);
  if (navItem) navItem.classList.add('active');
  currentSection = name;

  // Re-render charts when switching to sections that have them
  // (charts need visible container to render correctly)
  if (analyticsData) {
    if (name === 'overview') {
      setTimeout(() => {
        renderDailyChart(analyticsData.dailySeries);
        renderHourlyChart(analyticsData.hourlySeries);
      }, 50);
    }
    if (name === 'models') {
      setTimeout(() => renderModelChart(analyticsData.modelBreakdown), 50);
    }
  }
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  // Nav clicks
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      showSection(item.dataset.section);
    });
  });

  // Refresh button
  document.getElementById('refresh-btn').addEventListener('click', loadData);

  // Date range buttons
  document.querySelectorAll('.date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeDateRange = parseInt(btn.dataset.range, 10);
      loadData();
    });
  });

  // Load data and show app
  await loadData();
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  showSection('overview');
});
