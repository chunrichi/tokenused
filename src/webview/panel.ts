import * as vscode from 'vscode';
import { Database } from '../database/sqlite-wrapper';
import { getDatabase } from '../database/db';
import { getSummary, getTrend, getModelStackedData, getHeatmapData, getModelBreakdown, getToolUsageStats, refreshDailyStats, getHourlyUsage } from '../database/repositories/analyticsRepo';
import { searchChatContent, searchWorkspaces } from '../database/repositories/searchRepo';
import { formatDateISO } from '../utils/dateUtils';

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private db!: Database;

  private constructor(panel: vscode.WebviewPanel, db: Database) {
    this._panel = panel;
    this.db = db;
    this._panel.webview.html = this._getHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.onDidChangeViewState(() => {
      if (this._panel.visible) {
        this._sendDashboardData();
      }
    }, null, this._disposables);
    this._setWebviewMessageListener();
  }

  public static revive(panel: vscode.WebviewPanel, db: Database): void {
    DashboardPanel.currentPanel = new DashboardPanel(panel, db);
    DashboardPanel.currentPanel._sendDashboardData();
  }

  public static async createOrShow(context: vscode.ExtensionContext): Promise<void> {
    const column = vscode.ViewColumn.One;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel._panel.reveal(column);
      DashboardPanel.currentPanel._sendDashboardData();
      return;
    }

    const db = await getDatabase(context);
    const panel = vscode.window.createWebviewPanel(
      'copilotTokenTracker',
      'Copilot Token Tracker',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, db);
  }

  public refresh(): void {
    if (this._panel.visible) {
      this._sendDashboardData();
    }
  }

  private _sendDashboardData(range?: string): void {
    // Always rebuild daily_stats from token_usage
    try {
      refreshDailyStats(this.db);
    } catch {
      // Ignore errors
    }
    const today = new Date();
    const startDateObj = new Date(today);
    const r = range || '30d';
    if (r === '7d') startDateObj.setDate(today.getDate() - 6);
    else if (r === '30d') startDateObj.setDate(today.getDate() - 29);
    else if (r === '90d') startDateObj.setDate(today.getDate() - 89);
    else startDateObj.setFullYear(2020, 0, 1); // 'all'

    // Find the earliest date with data, use it as start if within range
    let startDate = formatDateISO(startDateObj);
    const earliest = this.db.prepare(
      'SELECT MIN(date) as minDate FROM daily_stats'
    ).get() as any;
    if (earliest?.minDate && earliest.minDate > startDate) {
      startDate = earliest.minDate;
    }
    const endDate = formatDateISO(today);

    const summary = getSummary(this.db);
    const trend = getTrend(this.db, startDate, endDate);
    const stacked = getModelStackedData(this.db, startDate, endDate);
    const heatmap = getHeatmapData(this.db, startDate, endDate);
    const models = getModelBreakdown(this.db, startDate, endDate);
    const tools = getToolUsageStats(this.db, startDate, endDate);
    const hourly = getHourlyUsage(this.db, startDate, endDate);

    this._panel.webview.postMessage({
      type: 'dashboardData',
      data: { summary, trend, stacked, heatmap, models, tools, hourly }
    });
  }

  private _setWebviewMessageListener(): void {
    this._panel.webview.onDidReceiveMessage(
      (message: any) => {
        switch (message.type) {
          case 'ready':
            this._sendDashboardData(message.range);
            break;
          case 'search':
            const results = searchChatContent(this.db, message.query, 20);
            const wsResults = searchWorkspaces(this.db, message.query);
            this._panel.webview.postMessage({
              type: 'searchResults',
              data: { chatResults: results, workspaceResults: wsResults }
            });
            break;
          case 'refresh':
            this._sendDashboardData(message.range);
            break;
          case 'openFolder':
            if (message.path) {
              vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(message.path), true);
            }
            break;
          case 'openWorkspace':
            if (message.path) {
              vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.path));
            }
            break;
          case 'copyPath':
            if (message.path) {
              vscode.env.clipboard.writeText(message.path);
              vscode.window.showInformationMessage(`Copied: ${message.path}`);
            }
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Copilot Token Tracker</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  padding: 16px;
  font-size: 13px;
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; padding-bottom: 12px;
  border-bottom: 1px solid var(--vscode-editorWidget-border);
}
.header h1 { font-size: 18px; font-weight: 600; }
.header-controls { display: flex; gap: 8px; align-items: center; }
.header-controls select, .header-controls button {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  padding: 4px 8px; border-radius: 4px; font-size: 12px;
  cursor: pointer;
}
.header-controls button:hover { background: var(--vscode-button-hoverBackground); }
.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.card {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 8px; padding: 16px;
}
.card-value { font-size: 24px; font-weight: 700; color: var(--vscode-textLink-foreground); }
.card-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.chart-box {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 8px; padding: 16px;
}
.chart-box h3 { font-size: 13px; margin-bottom: 12px; font-weight: 600; }
.chart-area { height: 200px; position: relative; }
canvas { width: 100% !important; height: 100% !important; }
.stacked-section { margin-bottom: 16px; }
.stacked-chart-container {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 8px; padding: 16px;
}
.stacked-chart-container h3 { font-size: 13px; margin-bottom: 8px; font-weight: 600; }
.controls { display: flex; gap: 6px; margin-bottom: 12px; }
.controls button {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  padding: 3px 10px; border-radius: 4px; font-size: 11px;
  cursor: pointer;
}
.controls button.active {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.chart-canvas-area { height: 220px; }
.search-section {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 8px; padding: 16px; margin-bottom: 16px;
}
.search-box {
  display: flex; gap: 8px; margin-bottom: 12px;
}
.search-box input {
  flex: 1; background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  padding: 6px 10px; border-radius: 4px; font-size: 12px;
}
.search-box button {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none; padding: 6px 14px; border-radius: 4px;
  cursor: pointer; font-size: 12px;
}
.search-results { max-height: 300px; overflow-y: auto; }
.search-result {
  padding: 8px 12px; border-bottom: 1px solid var(--vscode-editorWidget-border);
  display: flex; align-items: center; gap: 8px;
}
.search-result:last-child { border-bottom: none; }
.search-result:hover { background: var(--vscode-list-hoverBackground); }
.result-info { flex: 1; min-width: 0; }
.result-path { font-size: 11px; color: var(--vscode-textLink-foreground); }
.result-snippet { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-actions { display: flex; gap: 4px; }
.result-actions button {
  background: transparent; border: 1px solid var(--vscode-input-border);
  color: var(--vscode-input-foreground); padding: 2px 8px; border-radius: 3px;
  cursor: pointer; font-size: 10px;
}
.heatmap-grid { display: flex; flex-wrap: wrap; gap: 2px; }
.heatmap-cell {
  width: 14px; height: 14px; border-radius: 2px;
  background: var(--vscode-editorWidget-border);
  position: relative;
}
.heatmap-cell[data-tooltip]:hover::after {
  content: attr(data-tooltip);
  position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  padding: 4px 8px; border-radius: 4px;
  font-size: 10px; white-space: nowrap; z-index: 10;
}
.tool-list { list-style: none; }
.tool-item {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0; font-size: 12px;
}
.tool-bar {
  height: 14px; border-radius: 2px;
  background: var(--vscode-textLink-foreground);
  opacity: 0.7;
}
.empty-state { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
.chart-tooltip {
  position: fixed; pointer-events: none; z-index: 1000;
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  padding: 6px 10px; border-radius: 4px;
  font-size: 11px; white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  display: none;
}
.chart-tooltip .tt-label { color: var(--vscode-descriptionForeground); margin-bottom: 2px; }
.chart-tooltip .tt-value { color: var(--vscode-textLink-foreground); font-weight: 600; }
</style>
</head>
<body>
<div class="chart-tooltip" id="chartTooltip"></div>
<div class="header">
  <h1>Copilot Token Tracker</h1>
  <div class="header-controls">
    <select id="dateRange">
      <option value="7d">Last 7 Days</option>
      <option value="30d" selected>Last 30 Days</option>
      <option value="90d">Last 90 Days</option>
      <option value="all">All Time</option>
    </select>
    <button id="refreshBtn">Refresh</button>
  </div>
</div>

<div class="cards" id="summaryCards">
  <div class="card"><div class="card-value" id="todayTokens">-</div><div class="card-label">Today</div></div>
  <div class="card"><div class="card-value" id="weekTokens">-</div><div class="card-label">Last 7 Days</div></div>
  <div class="card"><div class="card-value" id="monthTokens">-</div><div class="card-label">Last 30 Days</div></div>
  <div class="card"><div class="card-value" id="totalTokens">-</div><div class="card-label">All Time</div></div>
</div>

<div class="stacked-section">
  <div class="stacked-chart-container">
    <h3>Token Trend</h3>
    <div style="height:200px;"><canvas id="trendChart"></canvas></div>
  </div>
</div>

<div class="chart-row">
  <div class="chart-box">
    <h3>24-Hour Token Usage</h3>
    <div class="chart-area"><canvas id="hourlyChart"></canvas></div>
  </div>
  <div class="chart-box">
    <h3>Usage Heatmap</h3>
    <div style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:8px;">
      Total: <span id="heatmapTotal">-</span> | Peak: <span id="heatmapPeak">-</span>
    </div>
    <div class="heatmap-grid" id="heatmapGrid"></div>
  </div>
</div>

<div class="stacked-section">
  <div class="stacked-chart-container">
    <h3>Token Usage by Model (Stacked)</h3>
    <div class="controls" id="stackedControls">
      <button class="active" data-group="day">Daily</button>
      <button data-group="week">Weekly</button>
      <button data-group="month">Monthly</button>
    </div>
    <div class="chart-canvas-area"><canvas id="stackedChart"></canvas></div>
    <div id="stackedLegend" style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:8px;font-size:11px;"></div>
  </div>
</div>

<div class="search-section">
  <h3 style="font-size:13px;margin-bottom:10px;font-weight:600;">Search Sessions & Projects</h3>
  <div class="search-box">
    <input type="text" id="searchInput" placeholder="Search conversations, projects, session IDs..." />
    <button id="searchBtn">Search</button>
  </div>
  <div class="search-results" id="searchResults"></div>
</div>

<div class="chart-row">
  <div class="chart-box">
    <h3>Model Breakdown</h3>
    <div id="modelBreakdown" style="font-size:12px;"></div>
  </div>
  <div class="chart-box">
    <h3>Top Tools Used</h3>
    <ul class="tool-list" id="toolList"></ul>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();

// Render helpers
function formatTokens(n) {
  if (n >= 1e9) return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return n.toString();
}

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Chart drawing (no external libs - simple canvas)
function showTooltip(x, y, lines) {
  const tt = document.getElementById('chartTooltip');
  tt.innerHTML = lines.map(l => '<div class="tt-label">' + l.label + '</div><div class="tt-value">' + l.value + '</div>').join('');
  tt.style.display = 'block';
  const ttRect = tt.getBoundingClientRect();
  let left = x + 12;
  let top = y - ttRect.height - 8;
  if (left + ttRect.width > window.innerWidth) left = x - ttRect.width - 12;
  if (top < 0) top = y + 12;
  tt.style.left = left + 'px';
  tt.style.top = top + 'px';
}
function hideTooltip() { document.getElementById('chartTooltip').style.display = 'none'; }

function drawLineChart(canvasId, labels, datasets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  const w = rect.width, h = rect.height;
  const pad = { top: 10, right: 10, bottom: 25, left: 45 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  // Find max
  let maxVal = 0;
  for (const ds of datasets) {
    for (const v of ds.data) if (v > maxVal) maxVal = v;
  }
  if (maxVal === 0) maxVal = 1;

  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = getCssVar('--vscode-editorWidget-border') || '#333';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = getCssVar('--vscode-descriptionForeground') || '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(formatTokens(maxVal * (1 - i/4)), pad.left - 5, y + 3);
  }

  // X labels
  ctx.fillStyle = getCssVar('--vscode-descriptionForeground') || '#888';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(labels.length / 7));
  for (let i = 0; i < labels.length; i += step) {
    const x = labels.length <= 1 ? pad.left + plotW / 2 : pad.left + (plotW / (labels.length - 1)) * i;
    ctx.fillText(labels[i].slice(5), x, h - 5);
  }

  // Draw lines
  const colors = ['#4FC3F7', '#81C784', '#FFB74D', '#E57373', '#BA68C8', '#4DB6AC'];
  for (let d = 0; d < datasets.length; d++) {
    const ds = datasets[d];
    const color = colors[d % colors.length];
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < ds.data.length; i++) {
      const x = pad.left + (plotW / Math.max(1, ds.data.length - 1)) * i;
      const y = pad.top + plotH * (1 - ds.data[i] / maxVal);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Fill area
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = color + '20';
    ctx.fill();
  }

  // Hover interaction
  canvas.onmousemove = function(e) {
    const cr = canvas.getBoundingClientRect();
    const mx = (e.clientX - cr.left);
    if (labels.length < 2) return;
    const idx = Math.round(((mx - pad.left) / plotW) * (labels.length - 1));
    if (idx < 0 || idx >= labels.length) { hideTooltip(); return; }
    const lines = [{ label: labels[idx], value: '' }];
    for (let d = 0; d < datasets.length; d++) {
      lines.push({ label: datasets[d].name, value: formatTokens(datasets[d].data[idx]) });
    }
    showTooltip(e.clientX, e.clientY, lines);
  };
  canvas.onmouseleave = hideTooltip;
}

function drawPieChart(canvasId, data) {
  // data: [{name, value, color}]
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  const w = rect.width, h = rect.height;
  const cx = w * 0.35, cy = h / 2;
  const r = Math.min(cx - 10, cy - 10);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return;

  ctx.clearRect(0, 0, w, h);

  let startAngle = -Math.PI / 2;
  const slices = [];
  for (const d of data) {
    const sliceAngle = (d.value / total) * 2 * Math.PI;
    const endAngle = startAngle + sliceAngle;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    ctx.strokeStyle = getCssVar('--vscode-editorWidget-background') || '#1e1e1e';
    ctx.lineWidth = 2;
    ctx.stroke();
    slices.push({ startAngle, endAngle, ...d });
    startAngle = endAngle;
  }

  // Legend
  const legendX = w * 0.65;
  const itemH = 20;
  const startY = Math.max(10, cy - (data.length * itemH) / 2);
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  for (let i = 0; i < data.length; i++) {
    const y = startY + i * itemH;
    ctx.fillStyle = data[i].color;
    ctx.fillRect(legendX, y, 10, 10);
    ctx.fillStyle = getCssVar('--vscode-editor-foreground') || '#ccc';
    const pct = ((data[i].value / total) * 100).toFixed(1);
    let shortName = data[i].name;
    if (shortName.length > 18) shortName = shortName.slice(0, 18) + '…';
    ctx.fillText(shortName + ' ' + formatTokens(data[i].value) + ' (' + pct + '%)', legendX + 16, y + 9);
  }

  // Hover
  canvas.onmousemove = function(e) {
    const cr = canvas.getBoundingClientRect();
    const mx = e.clientX - cr.left, my = e.clientY - cr.top;
    const dx = mx - cx, dy = my - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > r || dist < 0) { hideTooltip(); return; }
    let angle = Math.atan2(dy, dx);
    if (angle < -Math.PI / 2) angle += 2 * Math.PI;
    for (const s of slices) {
      let sa = s.startAngle, ea = s.endAngle;
      if (sa < -Math.PI / 2) { sa += 2 * Math.PI; ea += 2 * Math.PI; }
      if (angle >= sa && angle < ea) {
        showTooltip(e.clientX, e.clientY, [
          { label: s.name, value: formatTokens(s.value) + ' (' + ((s.value / total) * 100).toFixed(1) + '%)' }
        ]);
        return;
      }
    }
    hideTooltip();
  };
  canvas.onmouseleave = hideTooltip;
}

function drawBarChart(canvasId, labels, datasets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  const w = rect.width, h = rect.height;
  const pad = { top: 10, right: 10, bottom: 25, left: 45 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const barCount = labels.length;
  if (barCount === 0) return;

  // Find max
  let maxVal = 0;
  for (const ds of datasets) {
    for (const v of ds.data) if (v > maxVal) maxVal = v;
  }
  if (maxVal === 0) maxVal = 1;

  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = getCssVar('--vscode-editorWidget-border') || '#333';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = getCssVar('--vscode-descriptionForeground') || '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(formatTokens(maxVal * (1 - i/4)), pad.left - 5, y + 3);
  }

  const colors = ['#4FC3F7', '#81C784', '#FFB74D', '#E57373'];
  const barW = Math.max(6, (plotW / barCount) * 0.6);
  const gap = (plotW / barCount) * 0.4;

  for (let i = 0; i < barCount; i++) {
    const x = pad.left + (plotW / barCount) * i + gap / 2;
    let yOff = 0;
    for (let d = 0; d < datasets.length; d++) {
      const val = datasets[d].data[i] || 0;
      const barH = (val / maxVal) * plotH;
      const y = pad.top + plotH - yOff - barH;
      ctx.fillStyle = colors[d % colors.length];
      ctx.fillRect(x, y, barW, barH);
      yOff += barH;
    }
  }

  // X labels
  ctx.fillStyle = getCssVar('--vscode-descriptionForeground') || '#888';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  const xStep = Math.max(1, Math.floor(barCount / 12));
  for (let i = 0; i < barCount; i += xStep) {
    const x = pad.left + (plotW / barCount) * i + gap / 2 + barW / 2;
    ctx.fillText(labels[i], x, h - 5);
  }

  // Hover interaction
  canvas.onmousemove = function(e) {
    const cr = canvas.getBoundingClientRect();
    const mx = e.clientX - cr.left;
    const idx = Math.floor(((mx - pad.left) / plotW) * barCount);
    if (idx < 0 || idx >= barCount) { hideTooltip(); return; }
    const lines = [{ label: labels[idx], value: '' }];
    for (let d = 0; d < datasets.length; d++) {
      lines.push({ label: datasets[d].name, value: formatTokens(datasets[d].data[idx]) });
    }
    showTooltip(e.clientX, e.clientY, lines);
  };
  canvas.onmouseleave = hideTooltip;
}

function drawStackedBarChart(canvasId, labels, modelData) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  const w = rect.width, h = rect.height;
  const pad = { top: 10, right: 10, bottom: 25, left: 45 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  // modelData: { models: [{name, data: [n per label]}] }
  const models = modelData.models || [];
  const barCount = labels.length;
  if (barCount === 0) return;

  // Calculate totals per bar
  const totals = new Array(barCount).fill(0);
  for (const m of models) {
    for (let i = 0; i < barCount; i++) {
      totals[i] += (m.data[i] || 0);
    }
  }
  let maxVal = 0;
  for (const t of totals) if (t > maxVal) maxVal = t;
  if (maxVal === 0) maxVal = 1;

  // Grid
  ctx.strokeStyle = getCssVar('--vscode-editorWidget-border') || '#333';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = getCssVar('--vscode-descriptionForeground') || '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(formatTokens(maxVal * (1 - i/4)), pad.left - 5, y + 3);
  }

  const colors = ['#4FC3F7', '#81C784', '#FFB74D', '#E57373', '#BA68C8', '#4DB6AC', '#F06292', '#7986CB'];
  const barW = Math.max(8, (plotW / barCount) * 0.7);
  const gap = (plotW / barCount) * 0.3;

  for (let i = 0; i < barCount; i++) {
    const x = pad.left + (plotW / barCount) * i + gap / 2;
    let yOff = 0;
    for (let m = 0; m < models.length; m++) {
      const val = models[m].data[i] || 0;
      const barH = (val / maxVal) * plotH;
      const y = pad.top + plotH - yOff - barH;
      ctx.fillStyle = colors[m % colors.length];
      ctx.fillRect(x, y, barW, barH);
      yOff += barH;
    }
  }

  // X labels
  ctx.fillStyle = getCssVar('--vscode-descriptionForeground') || '#888';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(barCount / 8));
  for (let i = 0; i < barCount; i += step) {
    const x = pad.left + (plotW / barCount) * i + gap / 2 + barW / 2;
    ctx.fillText(labels[i].slice(5), x, h - 5);
  }

  // Hover interaction
  canvas.onmousemove = function(e) {
    const cr = canvas.getBoundingClientRect();
    const mx = e.clientX - cr.left;
    const idx = Math.floor(((mx - pad.left) / plotW) * barCount);
    if (idx < 0 || idx >= barCount) { hideTooltip(); return; }
    const total = totals[idx];
    const lines = [{ label: labels[idx], value: formatTokens(total) + ' total' }];
    for (let m = 0; m < models.length; m++) {
      const v = models[m].data[idx] || 0;
      if (v > 0) lines.push({ label: models[m].name, value: formatTokens(v) });
    }
    showTooltip(e.clientX, e.clientY, lines);
  };
  canvas.onmouseleave = hideTooltip;

  // HTML legend
  const legendEl = document.getElementById('stackedLegend');
  if (legendEl) {
    legendEl.innerHTML = models.map((m, i) => {
      let shortName = m.name;
      const colonIdx = shortName.lastIndexOf(':::');
      if (colonIdx >= 0) shortName = shortName.slice(colonIdx + 3);
      else {
        const slashIdx = shortName.lastIndexOf('/');
        if (slashIdx >= 0) shortName = shortName.slice(slashIdx + 1);
      }
      shortName = shortName.slice(0, 20);
      return '<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:' + colors[i % colors.length] + ';flex-shrink:0;"></span>' + shortName + '</span>';
    }).join('');
  }
}

// Data handling
let currentData = null;
let currentGroup = 'day';

window.addEventListener('message', event => {
  const msg = event.data;
  if (msg.type === 'dashboardData') {
    currentData = msg.data;
    renderDashboard();
  } else if (msg.type === 'refreshNeeded') {
    vscode.postMessage({ type: 'ready', range: document.getElementById('dateRange').value });
  } else if (msg.type === 'searchResults') {
    renderSearchResults(msg.data);
  }
});

function renderDashboard() {
  if (!currentData) return;
  const d = currentData;

  // Summary cards
  document.getElementById('todayTokens').textContent = formatTokens(d.summary.todayTokens);
  document.getElementById('weekTokens').textContent = formatTokens(d.summary.weekTokens);
  document.getElementById('monthTokens').textContent = formatTokens(d.summary.monthTokens);
  document.getElementById('totalTokens').textContent = formatTokens(d.summary.totalTokens);

  // Trend chart
  if (d.trend && d.trend.length > 0) {
    const labels = d.trend.map(t => t.date);
    const compData = d.trend.map(t => t.completionTokens || 0);
    const inputData = d.trend.map(t => t.estimatedInputTokens || 0);
    drawLineChart('trendChart', labels, [
      { name: 'Completion', data: compData },
      { name: 'Input (est)', data: inputData }
    ]);
  }

  // Stacked chart
  renderStackedChart();

  // Hourly chart
  if (d.hourly && d.hourly.length > 0) {
    const labels = d.hourly.map(h => String(h.hour).padStart(2, '0') + ':00');
    const compData = d.hourly.map(h => h.completionTokens || 0);
    const inputData = d.hourly.map(h => h.estimatedInputTokens || 0);
    drawBarChart('hourlyChart', labels, [
      { name: 'Completion', data: compData },
      { name: 'Input (est)', data: inputData }
    ]);
  }

  // Heatmap
  renderHeatmap(d.heatmap);

  // Model breakdown
  renderModelBreakdown(d.models);

  // Tools
  renderTools(d.tools);
}

function renderStackedChart() {
  if (!currentData || !currentData.stacked) return;
  const stacked = currentData.stacked;

  // Group data by currentGroup
  const dateMap = {};
  const modelSet = new Set();
  for (const s of stacked) {
    const d = groupDate(s.date, currentGroup);
    if (!dateMap[d]) dateMap[d] = {};
    dateMap[d][s.model_name || s.model_id] = (dateMap[d][s.model_name || s.model_id] || 0) + s.tokens;
    modelSet.add(s.model_name || s.model_id);
  }
  const labels = Object.keys(dateMap).sort();
  const models = Array.from(modelSet);
  const modelData = {
    models: models.map(m => ({
      name: m,
      data: labels.map(l => dateMap[l][m] || 0)
    }))
  };
  drawStackedBarChart('stackedChart', labels, modelData);
}

function groupDate(dateStr, group) {
  if (group === 'day') return dateStr;
  const d = new Date(dateStr);
  if (group === 'week') {
    const oneJan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
    return d.getFullYear() + '-W' + String(week).padStart(2, '0');
  }
  if (group === 'month') {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  return dateStr;
}

function renderHeatmap(data) {
  if (!data || data.length === 0) {
    document.getElementById('heatmapGrid').innerHTML = '<div class="empty-state">No data</div>';
    return;
  }
  let total = 0, peak = 0;
  for (const d of data) {
    total += d.tokens;
    if (d.tokens > peak) peak = d.tokens;
  }
  document.getElementById('heatmapTotal').textContent = formatTokens(total);
  document.getElementById('heatmapPeak').textContent = formatTokens(peak);

  const grid = document.getElementById('heatmapGrid');
  grid.innerHTML = '';
  for (const d of data) {
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    const intensity = peak > 0 ? d.tokens / peak : 0;
    const r = Math.round(79 + intensity * 100);
    const g = Math.round(195 - intensity * 80);
    const b = Math.round(247 - intensity * 100);
    cell.style.background = intensity > 0 ? \`rgb(\${r},\${g},\${b})\` : '';
    cell.setAttribute('data-tooltip', \`\${d.date}: \${formatTokens(d.tokens)}\`);
    grid.appendChild(cell);
  }
}

function renderModelBreakdown(models) {
  const el = document.getElementById('modelBreakdown');
  if (!models || models.length === 0) {
    el.innerHTML = '<div class="empty-state">No data</div>';
    return;
  }
  const colors = ['#4FC3F7', '#81C784', '#FFB74D', '#E57373', '#BA68C8', '#4DB6AC', '#F06292', '#7986CB'];
  const pieData = models.map((m, i) => ({
    name: m.model_name || m.model_id,
    value: m.total_tokens,
    color: colors[i % colors.length]
  }));
  el.innerHTML = '<div style="height:200px;"><canvas id="modelPieChart"></canvas></div>';
  // Need a small delay for the DOM to update
  requestAnimationFrame(() => drawPieChart('modelPieChart', pieData));
}

function renderTools(tools) {
  const el = document.getElementById('toolList');
  if (!tools || tools.length === 0) {
    el.innerHTML = '<div class="empty-state">No data</div>';
    return;
  }
  const maxCount = tools[0]?.count || 1;
  el.innerHTML = tools.slice(0, 10).map(t => {
    const pct = (t.count / maxCount) * 100;
    return \`<li class="tool-item">
      <span style="width:100px;flex-shrink:0;">\${t.tool_name}</span>
      <div style="flex:1;background:var(--vscode-editorWidget-border);border-radius:2px;height:14px;">
        <div class="tool-bar" style="width:\${pct}%;"></div>
      </div>
      <span style="font-size:11px;color:var(--vscode-descriptionForeground);">\${t.count}</span>
    </li>\`;
  }).join('');
}

function renderSearchResults(data) {
  const el = document.getElementById('searchResults');
  const all = [];
  if (data.workspaceResults) {
    for (const ws of data.workspaceResults) {
      all.push({ type: 'workspace', path: ws.folder_path, name: ws.name, id: ws.id, workspaceFile: ws.workspace_file });
    }
  }
  if (data.chatResults) {
    for (const r of data.chatResults) {
      all.push({ type: 'chat', ...r });
    }
  }
  if (all.length === 0) {
    el.innerHTML = '<div class="empty-state">No results found</div>';
    return;
  }
  el.innerHTML = all.map(r => {
    if (r.type === 'workspace') {
      const wsBtn = r.workspaceFile
        ? \`<button onclick="openWorkspace('\${escHtml(r.workspaceFile).replace(/'/g, "\\'")}')">Open Workspace</button>\`
        : '';
      return \`<div class="search-result">
        <div class="result-info">
          <div class="result-path">Project: \${escHtml(r.name)}</div>
          <div class="result-snippet">\${escHtml(r.path)}</div>
        </div>
        <div class="result-actions">
          <button onclick="openFolder('\${escHtml(r.path).replace(/'/g, "\\'")}')">Open Folder</button>
          \${wsBtn}
          <button onclick="copyPath('\${escHtml(r.path).replace(/'/g, "\\'")}')">Copy Path</button>
        </div>
      </div>\`;
    }
    return \`<div class="search-result">
      <div class="result-info">
        <div class="result-path">\${escHtml(r.workspace_name || r.workspace_path)} | \${escHtml(r.model_name || r.model_id)}</div>
        <div class="result-snippet">\${escHtml(r.snippet || '')}</div>
      </div>
      <div class="result-actions">
        <button onclick="openFolder('\${escHtml(r.workspace_path||'').replace(/'/g, "\\'")}')">Open</button>
        <button onclick="copyPath('\${escHtml(r.workspace_path||'').replace(/'/g, "\\'")}')">Copy Path</button>
      </div>
    </div>\`;
  }).join('');
}

function openFolder(path) { vscode.postMessage({ type: 'openFolder', path }); }
function openWorkspace(path) { vscode.postMessage({ type: 'openWorkspace', path }); }
function copyPath(path) { vscode.postMessage({ type: 'copyPath', path }); }
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// Event listeners
document.getElementById('refreshBtn').addEventListener('click', () => {
  const range = document.getElementById('dateRange').value;
  vscode.postMessage({ type: 'refresh', range });
});
document.getElementById('dateRange').addEventListener('change', (e) => {
  vscode.postMessage({ type: 'refresh', range: e.target.value });
});
document.getElementById('searchBtn').addEventListener('click', () => {
  const q = document.getElementById('searchInput').value.trim();
  if (q) vscode.postMessage({ type: 'search', query: q });
});
document.getElementById('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    if (q) vscode.postMessage({ type: 'search', query: q });
  }
});

// Stacked chart controls
document.getElementById('stackedControls').addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON') {
    document.querySelectorAll('#stackedControls button').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentGroup = e.target.dataset.group;
    renderStackedChart();
  }
});

// Initial ready
vscode.postMessage({ type: 'ready', range: document.getElementById('dateRange').value });
</script>
</body>
</html>`;
  }

  public dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
