const vscode = require('vscode');
const path = require('path');
const { EcodeTreeDataProvider } = require('./src/treeDataProvider');
const { EcodeSettingsWebviewProvider } = require('./src/settingsWebviewProvider');

function activate(context) {
  const cookieFile = path.join(context.globalStorageUri.fsPath, 'cookies.json');
  const treeDataProvider = new EcodeTreeDataProvider(cookieFile);
  const treeView = vscode.window.createTreeView('ecodeExplorer', {
    treeDataProvider,
    showCollapseAll: true,
  });

  const settingsWebviewProvider = new EcodeSettingsWebviewProvider(context.extensionUri, () => {
    treeDataProvider.refresh();
  });

  context.subscriptions.push(
    treeView,
    vscode.window.registerWebviewViewProvider('ecodeSettings', settingsWebviewProvider)
  );

  const refreshAll = () => {
    treeDataProvider.refresh();
    settingsWebviewProvider.refresh();
  };

  context.subscriptions.push(vscode.commands.registerCommand('ecode.refresh', () => refreshAll()));

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.downloadFile', async (item) => {
      await treeDataProvider.downloadFile(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'ecode');
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('ecode.baseUrl') ||
        e.affectsConfiguration('ecode.username') ||
        e.affectsConfiguration('ecode.password') ||
        e.affectsConfiguration('ecode.localDir')
      ) {
        refreshAll();
      }
    })
  );
}

function deactivate() {
  // cleanup if needed
}

module.exports = {
  activate,
  deactivate,
};
