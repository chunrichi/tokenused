import * as vscode from 'vscode';
import { Database } from '../database/sqlite-wrapper';
import { getDatabase } from '../database/db';
import { getSummary, refreshDailyStats } from '../database/repositories/analyticsRepo';

export class TokenUsageSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'copilotTokenTracker.dashboard';
  private _view?: vscode.WebviewView;
  private db?: Database;
  private _initPromise: Promise<void>;
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this._initPromise = this.init(context);
  }

  private async init(context: vscode.ExtensionContext): Promise<void> {
    this.db = await getDatabase(context);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    // Clean up previous listeners if resolve is called again
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];

    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    webviewView.onDidDispose(() => {
      this._view = undefined;
      this._disposables.forEach(d => d.dispose());
      this._disposables = [];
    }, null, this._disposables);

    // Refresh data when sidebar becomes visible again
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._refresh();
      }
    }, null, this._disposables);

    webviewView.webview.onDidReceiveMessage(async (msg: any) => {
      switch (msg.type) {
        case 'ready':
          await this._initPromise;
          this._refresh();
          break;
        case 'openDashboard':
          vscode.commands.executeCommand('copilotTokenTracker.showDashboard');
          break;
        case 'syncNow':
          vscode.commands.executeCommand('copilotTokenTracker.syncNow');
          break;
      }
    }, null, this._disposables);
  }

  public async refresh(): Promise<void> {
    await this._initPromise;
    this._refresh();
  }

  private _refresh(): void {
    if (!this._view || !this.db) return;
    refreshDailyStats(this.db);
    const summary = getSummary(this.db);
    this._view.webview.postMessage({ type: 'update', data: summary });
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--vscode-sideBar-background);
  color: var(--vscode-sideBar-foreground);
  padding: 12px;
  font-size: 12px;
}
.section { margin-bottom: 14px; }
.section-title {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground); margin-bottom: 6px;
}
.stat-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 0;
}
.stat-label { color: var(--vscode-descriptionForeground); }
.stat-value { font-weight: 600; font-size: 14px; color: var(--vscode-textLink-foreground); }
.stat-value.highlight { font-size: 18px; }
.btn {
  display: block; width: 100%; padding: 6px 0; margin-top: 6px;
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  border: none; border-radius: 4px; cursor: pointer; font-size: 12px; text-align: center;
}
.btn:hover { background: var(--vscode-button-hoverBackground); }
.btn.secondary {
  background: transparent; border: 1px solid var(--vscode-button-secondaryBorder);
  color: var(--vscode-button-secondaryForeground);
}
.btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.loading { color: var(--vscode-descriptionForeground); font-style: italic; padding: 20px 0; text-align: center; }
</style>
</head>
<body>
<div id="content"><div class="loading">Loading...</div></div>
<script>
const vscode = acquireVsCodeApi();
window.addEventListener('message', event => {
  if (event.data.type === 'update') render(event.data.data);
});

function fmt(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return n.toString();
}

function render(d) {
  document.getElementById('content').innerHTML = \`
    <div class="section">
      <div class="section-title">Token Usage</div>
      <div class="stat-row">
        <span class="stat-label">Today</span>
        <span class="stat-value highlight">\${fmt(d.todayTokens)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Last 7 days</span>
        <span class="stat-value">\${fmt(d.weekTokens)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Last 30 days</span>
        <span class="stat-value">\${fmt(d.monthTokens)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">All time</span>
        <span class="stat-value">\${fmt(d.totalTokens)}</span>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Activity</div>
      <div class="stat-row">
        <span class="stat-label">Sessions</span>
        <span class="stat-value">\${d.totalSessions}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Requests</span>
        <span class="stat-value">\${fmt(d.totalRequests)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Avg response</span>
        <span class="stat-value">\${(d.avgResponseTime/1000).toFixed(1)}s</span>
      </div>
    </div>
    <div class="section">
      <button class="btn" onclick="vscode.postMessage({type:'openDashboard'})">Open Dashboard</button>
      <button class="btn secondary" onclick="vscode.postMessage({type:'syncNow'})">Sync Now</button>
    </div>
  \`;
}
vscode.postMessage({type:'ready'});
</script>
</body>
</html>`;
  }
}
