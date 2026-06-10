import * as vscode from 'vscode';
import { SyncService } from './services/syncService';
import { DashboardPanel } from './webview/panel';
import { TokenUsageSidebarProvider } from './webview/sidebar';
import { closeDatabase } from './database/db';

let syncService: SyncService | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Copilot Token Tracker activated');

  // Initialize sync service
  syncService = new SyncService(context);

  // Register sidebar view provider
  const sidebarProvider = new TokenUsageSidebarProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TokenUsageSidebarProvider.viewType, sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Refresh sidebar when sync completes
  syncService.onSyncComplete(() => {
    sidebarProvider.refresh();
  });

  // Command: Show Dashboard
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotTokenTracker.showDashboard', async () => {
      await DashboardPanel.createOrShow(context);
    })
  );

  // Command: Sync Now
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotTokenTracker.syncNow', async () => {
      vscode.window.showInformationMessage('Copilot Token Tracker: Syncing...');
      await syncService!.sync();
      vscode.window.showInformationMessage('Copilot Token Tracker: Sync complete!');
    })
  );

  // Command: Search Sessions
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotTokenTracker.searchSessions', async () => {
      await DashboardPanel.createOrShow(context);
    })
  );

  // Listen for sync completion to refresh dashboard
  syncService.onSyncComplete(() => {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.refresh();
    }
  });

  // Auto sync on startup if configured
  const config = vscode.workspace.getConfiguration('copilotTokenTracker');
  const autoSync = config.get<boolean>('autoSync', true);
  const interval = config.get<number>('syncIntervalMinutes', 30);

  if (autoSync) {
    syncService.startAutoSync(interval);
  }

  // Register status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(graph) Token Tracker';
  statusBarItem.tooltip = 'Open Copilot Token Tracker Dashboard';
  statusBarItem.command = 'copilotTokenTracker.showDashboard';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export function deactivate() {
  if (syncService) {
    syncService.dispose();
    syncService = undefined;
  }
  closeDatabase();
}
