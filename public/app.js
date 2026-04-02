'use strict';

// ===== State =====
let analyticsData = null;
let dailyChart = null;
let hourlyChart = null;
let modelPieChart = null;
let currentSection = 'overview';
let activeDateRange = 0;       // 0 = all time
let customStart = null;
let customEnd = null;
let activeModelTab = null;
let allSessions = [];          // cached for search filtering

// ===== Formatting helpers =====
function fmt$(n) {
  if (!n || n < 0.0001) return '$0.00';
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

function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtShortDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function shortModelName(m) {
  if (!m) return 'unknown';
  if (m.includes('opus')) return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku')) return 'Haiku';
  return m.split('-').slice(0, 3).join('-');
}

function modelClass(m) {
  if (!m) return '';
  if (m.includes('opus')) return 'model-opus';
  if (m.includes('sonnet')) return 'model-sonnet';
  if (m.includes('haiku')) return 'model-haiku';
  return '';
}

function clientIcon(client) {
  if (!client) return '💻';
  const c = client.toLowerCase();
  if (c.includes('mobile'))   return '📱';
  if (c.includes('vscode'))   return '🖥️';
  if (c.includes('jetbrains')) return '🖥️';
  if (c.includes('desktop'))  return '🖥️';
  if (c.includes('web'))      return '🌐';
  return '⌨️'; // Terminal CLI
}

function clientBadgeClass(client) {
  if (!client) return 'client-cli';
  const c = client.toLowerCase();
  if (c.includes('mobile'))    return 'client-mobile';
  if (c.includes('web'))       return 'client-web';
  if (c.includes('vscode'))    return 'client-vscode';
  if (c.includes('jetbrains')) return 'client-jetbrains';
  if (c.includes('desktop'))   return 'client-desktop';
  return 'client-cli';
}

function modelDotClass(m) {
  if (!m) return '';
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return '';
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== Chart defaults =====
Chart.defaults.color = '#888898';
Chart.defaults.borderColor = '#2a2a30';
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size = 12;

function ttCfg() {
  return {
    backgroundColor: '#1a1a1e', borderColor: '#2a2a30', borderWidth: 1,
    titleColor: '#e8e8ed', bodyColor: '#888898', padding: 10, cornerRadius: 6,
  };
}

// ===== Summary cards =====
function renderSummaryCards(s) {
  document.getElementById('total-cost').textContent = fmt$(s.totalCost);
  document.getElementById('total-all-tokens').textContent = fmtTokens(s.totalAllTokens);
  document.getElementById('cache-hit-rate').textContent = `${s.cacheHitRate}%`;
  document.getElementById('cache-savings').textContent = fmt$(s.totalCacheReadSavings);
  document.getElementById('total-messages-sub').textContent = `${s.totalMessages.toLocaleString()} messages`;
  document.getElementById('total-token-breakdown').textContent =
    `${fmtTokens(s.totalInputTokens)} in · ${fmtTokens(s.totalCacheWrite)} cache w · ${fmtTokens(s.totalOutputTokens)} out`;
  document.getElementById('cache-read-sub').textContent = `${fmtTokens(s.totalCacheRead)} tokens from cache`;
  document.getElementById('total-sessions-sub').textContent = `${s.totalSessions} sessions · ${s.totalProjects} projects`;
}

// ===== Daily chart =====
function renderDailyChart(series) {
  const ctx = document.getElementById('daily-chart').getContext('2d');
  if (dailyChart) dailyChart.destroy();
  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: series.map(d => {
        const [y, m, day] = d.date.split('-');
        return `${m}/${day}`;
      }),
      datasets: [
        { label:'Cost ($)', data: series.map(d => d.cost), backgroundColor:'rgba(217,119,6,0.7)', borderColor:'#d97706', borderWidth:1, borderRadius:4, yAxisID:'y' },
        { label:'Output Tokens', data: series.map(d => d.outputTokens), type:'line', borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.08)', borderWidth:2, pointRadius:3, pointBackgroundColor:'#3b82f6', tension:0.3, fill:true, yAxisID:'y2' },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{display:false}, tooltip:{ ...ttCfg(), callbacks:{ label:(c)=> c.datasetIndex===0 ? ` Cost: ${fmt$(c.parsed.y)}` : ` Output: ${fmtTokens(c.parsed.y)}` } } },
      scales:{
        x:{ grid:{color:'#1e1e24'}, ticks:{maxRotation:45,font:{size:11}} },
        y:{ type:'linear', position:'left', grid:{color:'#1e1e24'}, ticks:{callback:v=>fmt$(v),font:{size:11}} },
        y2:{ type:'linear', position:'right', grid:{drawOnChartArea:false}, ticks:{callback:v=>fmtTokens(v),font:{size:11}} },
      },
    },
  });
}

// ===== Hourly chart =====
function renderHourlyChart(series) {
  const ctx = document.getElementById('hourly-chart').getContext('2d');
  if (hourlyChart) hourlyChart.destroy();
  const messages = series.map(h => h.messages);
  const costs = series.map(h => h.cost);
  const maxMsg = Math.max(...messages, 1);
  hourlyChart = new Chart(ctx, {
    type:'bar',
    data:{
      labels: series.map(h => `${String(h.hour).padStart(2,'0')}:00`),
      datasets:[{ label:'Messages', data:messages, backgroundColor:messages.map(m=>`rgba(217,119,6,${0.1+(m/maxMsg)*0.8})`), borderColor:'transparent', borderRadius:3 }],
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ ...ttCfg(), callbacks:{ label:(c)=>[` ${c.parsed.y} messages`,` Cost: ${fmt$(costs[c.dataIndex])}`] } } },
      scales:{ x:{grid:{display:false},ticks:{font:{size:10},maxRotation:0}}, y:{grid:{color:'#1e1e24'},ticks:{font:{size:11},stepSize:1}} },
    },
  });
}

// ===== Sessions table =====
function renderSessionsTable(sessions, filter = '') {
  const tbody = document.getElementById('sessions-tbody');
  const countLabel = document.getElementById('sessions-count');

  let list = sessions;
  if (filter) {
    const q = filter.toLowerCase();
    list = sessions.filter(s =>
      s.projectName.toLowerCase().includes(q) ||
      (s.firstPrompt || '').toLowerCase().includes(q) ||
      s.sessionId.toLowerCase().includes(q)
    );
  }

  countLabel.textContent = `${list.length} session${list.length !== 1 ? 's' : ''}`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-state-icon">📂</div><h3>No sessions found</h3><p>${filter ? 'No matches for "' + escapeHtml(filter) + '"' : 'No Claude Code sessions detected'}</p></div></td></tr>`;
    return;
  }

  const maxCost = Math.max(...list.map(s => s.cost), 0.0001);

  tbody.innerHTML = list.map(s => {
    const barW = Math.round((s.cost / maxCost) * 60);
    const model = (s.models || [])[0] || '';
    const dotCls = modelDotClass(model);
    return `
      <tr data-session-id="${escapeHtml(s.sessionId)}" data-first-prompt="${escapeHtml(s.firstPrompt || '')}">
        <td style="white-space:nowrap;color:var(--text-muted);font-size:0.78rem">
          ${fmtShortDate(s.firstTimestamp)}<br>
          <span style="font-size:0.7rem;color:var(--text-dim)">${fmtShortDate(s.lastTimestamp)}</span>
        </td>
        <td>
          <div class="first-prompt-cell" title="${escapeHtml(s.firstPrompt || '')}">${escapeHtml(s.firstPrompt || '—')}</div>
          <div style="margin-top:3px"><span class="project-badge" title="${escapeHtml(s.projectName)}">${escapeHtml(s.projectName)}</span></div>
        </td>
        <td>
          <span class="client-badge ${clientBadgeClass(s.client)}" title="${escapeHtml(s.client)}">
            ${clientIcon(s.client)} ${escapeHtml(s.client || 'Terminal CLI')}
          </span>
        </td>
        <td>
          ${model ? `<span class="model-dot ${dotCls}" style="margin-right:4px"></span><span class="${modelClass(model)}" style="font-size:0.78rem">${shortModelName(model)}</span>` : '—'}
        </td>
        <td class="num">${s.messages}</td>
        <td class="num">${fmtTokens(s.totalTokens)}</td>
        <td class="num">${fmtTokens(s.inputTokens)}</td>
        <td class="num">${fmtTokens(s.outputTokens)}</td>
        <td>
          <div class="cost-bar-wrap">
            <div class="cost-bar" style="width:${barW}px"></div>
            <span style="font-family:'JetBrains Mono',monospace;color:var(--accent-light);font-size:0.82rem">${fmt$(s.cost)}</span>
          </div>
        </td>
      </tr>`;
  }).join('');

  // Click → open session detail modal
  tbody.querySelectorAll('tr[data-session-id]').forEach(row => {
    row.addEventListener('click', () => openSessionModal(row.dataset.sessionId, row.dataset.firstPrompt));
  });
}

// ===== Session modal =====
async function openSessionModal(sessionId, firstPrompt) {
  const modal = document.getElementById('session-modal');
  const titleEl = document.getElementById('modal-title');
  const subtitleEl = document.getElementById('modal-subtitle');
  const efficiencyEl = document.getElementById('modal-efficiency');
  const turnsEl = document.getElementById('modal-turns');

  titleEl.textContent = firstPrompt ? (firstPrompt.slice(0, 60) + (firstPrompt.length > 60 ? '…' : '')) : 'Session Detail';
  subtitleEl.textContent = `Session: ${sessionId.slice(0, 16)}…`;
  efficiencyEl.style.display = 'none';
  turnsEl.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted)">Loading…</div>';
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  try {
    const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    const { turns, summary } = json.data;

    // Update subtitle with real stats
    subtitleEl.textContent = `${fmtShortDate(turns[0]?.timestamp)} · ${shortModelName(turns[0]?.model || '')} · ${summary.totalTurns} messages · ${fmtTokens(summary.totalTokens)} tokens`;

    // Efficiency badge
    if (summary.efficiencyNote) {
      const cls = summary.efficient ? 'good' : 'warn';
      const icon = summary.efficient ? '✅' : '⚠️';
      efficiencyEl.innerHTML = `<div class="efficiency-badge ${cls}"><span>${icon}</span><div><span>${summary.efficient ? 'This conversation was efficient' : 'This conversation was costly'}</span><div class="efficiency-note">${escapeHtml(summary.efficiencyNote)}</div></div></div>`;
      efficiencyEl.style.display = 'block';
    }

    if (!turns.length) {
      turnsEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div><h3>No turns found</h3></div>';
      return;
    }

    turnsEl.innerHTML = turns.map(t => `
      <div class="turn-row">
        <div class="turn-num">${t.turnNumber}</div>
        <div class="turn-content">
          <div class="turn-prompt ${!t.userPrompt ? 'empty' : ''}">${t.userPrompt ? escapeHtml(t.userPrompt) + (t.userPrompt.length >= 400 ? '…' : '') : '[ Tool call / no user prompt ]'}</div>
          <div class="turn-stats">
            <span>${fmtDateTime(t.timestamp)}</span>
            ${t.model ? `<span><span class="model-dot ${modelDotClass(t.model)}" style="margin-right:3px"></span>${shortModelName(t.model)}</span>` : ''}
            <span>${fmt$(t.cost)}</span>
          </div>
        </div>
        <div>
          <div class="turn-total-tokens">${fmtTokens(t.totalTokens)}</div>
          <div class="turn-token-detail">${fmtTokens(t.inputTokens)} in / ${fmtTokens(t.cacheRead)} cached / ${fmtTokens(t.outputTokens)} out</div>
        </div>
      </div>`).join('');
  } catch (err) {
    turnsEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">❌</div><h3>Failed to load</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function closeSessionModal() {
  document.getElementById('session-modal').style.display = 'none';
  document.body.style.overflow = '';
}

// ===== Costly queries =====
function renderTopMessages(messages) {
  const container = document.getElementById('messages-list');
  if (!messages || messages.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💬</div><h3>No messages yet</h3></div>`;
    return;
  }
  container.innerHTML = messages.map((m, i) => {
    const isAuto = m.isAutomated;
    return `
    <div class="message-card${isAuto ? ' automated' : ''}">
      <div class="message-rank">
        <span>#${i + 1} · ${fmtDateTime(m.timestamp)}</span>
        <div class="message-badges">
          ${isAuto ? '<span class="auto-badge">Auto</span>' : ''}
          <span class="message-tokens-badge">${fmtTokens(m.totalTokens)} total tokens</span>
          <span class="message-cost-badge">${fmt$(m.cost)}</span>
        </div>
      </div>
      ${m.prompt
        ? `<div class="message-prompt ${isAuto ? 'muted' : ''}">${escapeHtml(m.prompt)}${(!isAuto && m.prompt.length >= 200) ? '…' : ''}</div>`
        : `<div class="no-prompt-wrap">
             <div class="no-prompt-label">No user message in this turn</div>
             <div class="no-prompt-chips">
               <span class="type-chip tc-tool">⚙ Tool result</span>
               <span class="type-chip tc-cont">↩ Auto-continuation</span>
             </div>
           </div>`
      }
      <div class="message-meta">
        <span><span class="meta-label">Model:</span> <span class="model-pill ${modelClass(m.model)}">${shortModelName(m.model)}</span></span>
        <span><span class="meta-label">Input:</span> ${fmtTokens(m.inputTokens)}</span>
        <span><span class="meta-label">Cache R:</span> ${fmtTokens(m.cacheRead)}</span>
        <span><span class="meta-label">Output:</span> ${fmtTokens(m.outputTokens)}</span>
        <span><span class="meta-label">Project:</span> <span style="color:var(--text-muted)">${escapeHtml(m.projectName)}</span></span>
      </div>
    </div>`;
  }).join('');
}

// ===== Model chart =====
function renderModelChart(breakdown) {
  const ctx = document.getElementById('model-pie-chart').getContext('2d');
  if (modelPieChart) modelPieChart.destroy();
  if (!breakdown || breakdown.length === 0) return;
  const COLORS = ['#d97706','#3b82f6','#22c55e','#a78bfa','#f43f5e','#06b6d4'];
  modelPieChart = new Chart(ctx, {
    type:'doughnut',
    data:{
      labels: breakdown.map(m => shortModelName(m.model)),
      datasets:[{ data:breakdown.map(m=>m.cost), backgroundColor:COLORS.slice(0,breakdown.length), borderColor:'#141416', borderWidth:2 }],
    },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'60%',
      plugins:{
        legend:{position:'bottom',labels:{padding:16,font:{size:12},color:'#888898'}},
        tooltip:{ ...ttCfg(), callbacks:{ label:(c)=>{ const t=c.dataset.data.reduce((a,b)=>a+b,0); return ` ${fmt$(c.parsed)} (${t>0?((c.parsed/t)*100).toFixed(1):0}%)`; } } },
      },
    },
  });
}

// ===== Model stats table =====
function renderModelTable(breakdown, totalCost) {
  const tbody = document.getElementById('model-tbody');
  if (!breakdown || breakdown.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:20px">No data</td></tr>';
    return;
  }
  tbody.innerHTML = breakdown.map(m => {
    const pct = totalCost > 0 ? ((m.cost / totalCost) * 100).toFixed(1) : '0.0';
    return `<tr>
      <td>
        <span class="model-dot ${modelDotClass(m.model)}" style="margin-right:5px"></span>
        <span class="${modelClass(m.model)}" style="font-weight:500">${shortModelName(m.model)}</span>
        <span style="margin-left:6px;font-size:0.72rem;color:var(--text-dim)">${escapeHtml(m.model)}</span>
      </td>
      <td class="num">${m.messages.toLocaleString()}</td>
      <td class="num">${fmtTokens(m.totalTokens)}</td>
      <td class="num">${fmtTokens(m.inputTokens)}</td>
      <td class="num">${fmtTokens(m.outputTokens)}</td>
      <td class="cost">${fmt$(m.cost)}</td>
      <td class="right">
        <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
          <div style="width:60px;height:4px;border-radius:2px;background:var(--bg3);overflow:hidden">
            <div style="height:100%;width:${Math.min(100,parseFloat(pct))}%;background:var(--accent);border-radius:2px"></div>
          </div>
          <span style="font-size:0.78rem;color:var(--text-muted)">${pct}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ===== Model queries =====
const MODEL_QUERIES_PAGE_SIZE = 25;
const modelQueriesPage = {};   // model -> current page index (0-based)

function renderModelQueries(modelBreakdown, modelQueries) {
  const tabRow = document.getElementById('model-queries-tabs');
  const content = document.getElementById('model-queries-content');
  if (!modelBreakdown || modelBreakdown.length === 0) { tabRow.innerHTML = ''; content.innerHTML = ''; return; }

  // Tabs show the TRUE count from modelBreakdown (not the array length)
  tabRow.innerHTML = modelBreakdown.map((m, i) =>
    `<button class="tab-btn${i === 0 ? ' active' : ''}" data-model="${escapeHtml(m.model)}">
       <span class="model-dot ${modelDotClass(m.model)}" style="margin-right:4px"></span>
       ${shortModelName(m.model)}
       <span class="tab-count">${m.messages.toLocaleString()}</span>
     </button>`
  ).join('');

  const showTab = (model, page = 0) => {
    tabRow.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.model === model));
    modelQueriesPage[model] = page;
    const all = modelQueries[model] || [];
    if (!all.length) {
      content.innerHTML = '<p style="color:var(--text-muted);padding:12px 0">No queries recorded for this model.</p>';
      return;
    }
    const start = page * MODEL_QUERIES_PAGE_SIZE;
    const slice = all.slice(start, start + MODEL_QUERIES_PAGE_SIZE);
    const hasMore = start + MODEL_QUERIES_PAGE_SIZE < all.length;
    const hasPrev = page > 0;

    content.innerHTML = slice.map((m, i) => {
      const rank = start + i + 1;
      const isAuto = m.isAutomated;
      return `
        <div class="message-card${isAuto ? ' automated' : ''}">
          <div class="message-rank">
            <span>#${rank} · ${fmtDateTime(m.timestamp)}</span>
            <div class="message-badges">
              ${isAuto ? '<span class="auto-badge">Auto</span>' : ''}
              <span class="message-tokens-badge">${fmtTokens(m.totalTokens)} tokens</span>
              <span class="message-cost-badge">${fmt$(m.cost)}</span>
            </div>
          </div>
          ${m.prompt
            ? `<div class="message-prompt ${isAuto ? 'muted' : ''}">${escapeHtml(m.prompt)}${(m.prompt.length >= 200 ? '…' : '')}</div>`
            : `<div class="no-prompt-wrap">
                 <div class="no-prompt-label">No user message in this turn</div>
                 <div class="no-prompt-chips">
                   <span class="type-chip tc-tool">⚙ Tool result</span>
                   <span class="type-chip tc-cont">↩ Auto-continuation</span>
                 </div>
               </div>`
          }
          <div class="message-meta">
            <span><span class="meta-label">Input:</span> ${fmtTokens(m.inputTokens)}</span>
            <span><span class="meta-label">Cache R:</span> ${fmtTokens(m.cacheRead)}</span>
            <span><span class="meta-label">Output:</span> ${fmtTokens(m.outputTokens)}</span>
            <span><span class="meta-label">Project:</span> ${escapeHtml(m.projectName)}</span>
          </div>
        </div>`;
    }).join('');

    // Pagination row
    const paginationEl = document.createElement('div');
    paginationEl.className = 'pagination-row';
    paginationEl.innerHTML = `
      <span class="pagination-info">Showing ${start + 1}–${Math.min(start + MODEL_QUERIES_PAGE_SIZE, all.length)} of ${all.length.toLocaleString()}</span>
      <div class="pagination-btns">
        ${hasPrev ? `<button class="page-btn" data-page="${page - 1}">← Prev</button>` : ''}
        ${hasMore ? `<button class="page-btn" data-page="${page + 1}">Next →</button>` : ''}
      </div>`;
    content.appendChild(paginationEl);
    paginationEl.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => showTab(model, parseInt(btn.dataset.page)));
    });
  };

  const firstModel = modelBreakdown[0]?.model;
  if (firstModel) { activeModelTab = firstModel; showTab(firstModel, 0); }

  tabRow.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => { activeModelTab = btn.dataset.model; showTab(activeModelTab, 0); });
  });
}

// ===== Insights =====
function renderInsights(insights) {
  const grid = document.getElementById('insights-grid');
  if (!insights || insights.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted)">No insights yet — keep using Claude Code!</p>';
    return;
  }
  grid.innerHTML = insights.map((tip, i) => `
    <div class="insight-card" data-index="${i}">
      <div class="insight-header">
        <div class="insight-icon-wrap">${tip.icon}</div>
        <div class="insight-header-text">
          <div class="insight-title">${escapeHtml(tip.title)}</div>
          <div class="insight-summary">${escapeHtml(tip.summary || '')}</div>
        </div>
        <svg class="insight-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="insight-body">${escapeHtml(tip.detail || '')}</div>
    </div>`).join('');

  grid.querySelectorAll('.insight-card').forEach(card => {
    card.addEventListener('click', () => card.classList.toggle('expanded'));
  });
}

// ===== Date range helpers =====
function getDateRange(days) {
  if (days === 0 || days === 'custom') return { start: customStart, end: customEnd };
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  const f = d => d.toISOString().slice(0, 10);
  return { start: f(start), end: f(end) };
}

function updateDateLabel(days) {
  const label = document.getElementById('date-range-label');
  if (days === 0 && !customStart) { label.textContent = 'All time'; return; }
  const { start, end } = getDateRange(days);
  if (!start && !end) { label.textContent = 'All time'; return; }
  const fmt = s => new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  label.textContent = `${start ? fmt(start) : '…'} – ${end ? fmt(end) : '…'}`;
}

// ===== Data loading =====
async function loadData() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
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
    allSessions = json.data.sessions;
    renderAll(analyticsData);
    updateDateLabel(activeDateRange);
    document.getElementById('last-updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error('Failed to load analytics:', err);
    document.getElementById('last-updated').textContent = 'Error loading data';
  } finally {
    btn.classList.remove('spinning');
  }
}

function renderAll(data) {
  renderSummaryCards(data.summary);
  renderDailyChart(data.dailySeries);
  renderHourlyChart(data.hourlySeries);
  renderSessionsTable(data.sessions, document.getElementById('sessions-search')?.value || '');
  renderTopMessages(data.topMessages);
  renderModelChart(data.modelBreakdown);
  renderModelTable(data.modelBreakdown, data.summary.totalCost);
  renderModelQueries(data.modelBreakdown, data.modelQueries);
  renderInsights(data.insights);
}

// ===== Navigation =====
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById(name);
  if (sec) sec.style.display = 'block';
  const nav = document.querySelector(`[data-section="${name}"]`);
  if (nav) nav.classList.add('active');
  currentSection = name;
  if (analyticsData) {
    if (name === 'overview') setTimeout(() => { renderDailyChart(analyticsData.dailySeries); renderHourlyChart(analyticsData.hourlySeries); }, 50);
    if (name === 'models') setTimeout(() => renderModelChart(analyticsData.modelBreakdown), 50);
  }
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  // Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => { e.preventDefault(); showSection(item.dataset.section); });
  });

  // Refresh
  document.getElementById('refresh-btn').addEventListener('click', loadData);

  // Date preset buttons
  document.querySelectorAll('.date-btn').forEach(btn => {
    if (btn.dataset.range === 'custom') {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const ci = document.getElementById('custom-date-inputs');
        ci.style.display = ci.style.display === 'none' ? 'flex' : 'none';
      });
      return;
    }
    btn.addEventListener('click', () => {
      document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('custom-date-inputs').style.display = 'none';
      activeDateRange = parseInt(btn.dataset.range, 10);
      customStart = null; customEnd = null;
      loadData();
    });
  });

  // Custom date apply
  document.getElementById('date-apply-btn').addEventListener('click', () => {
    customStart = document.getElementById('date-start').value || null;
    customEnd = document.getElementById('date-end').value || null;
    activeDateRange = 'custom';
    loadData();
  });

  // Session search
  document.getElementById('sessions-search').addEventListener('input', e => {
    renderSessionsTable(allSessions, e.target.value);
  });

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeSessionModal);
  document.getElementById('session-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('session-modal')) closeSessionModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSessionModal(); });

  // How tokens work toggle
  const toggle = document.getElementById('tokens-explainer-toggle');
  const body = document.getElementById('tokens-explainer-body');
  const chevron = toggle.querySelector('.chevron');
  toggle.addEventListener('click', () => {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    chevron.classList.toggle('open', !isOpen);
  });

  // Load
  await loadData();
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  showSection('overview');
});
