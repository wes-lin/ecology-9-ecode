const vscode = require('vscode');
const path = require('path');
const { EcodeTreeDataProvider } = require('./src/treeDataProvider');

function activate(context) {
  const cookieFile = path.join(context.globalStorageUri.fsPath, 'cookies.json');
  const treeDataProvider = new EcodeTreeDataProvider(cookieFile);
  const treeView = vscode.window.createTreeView('ecodeExplorer', {
    treeDataProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(treeView);

  context.subscriptions.push(vscode.commands.registerCommand('ecode.refresh', () => treeDataProvider.refresh()));

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.downloadFile', async (item) => {
      await treeDataProvider.downloadFile(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.viewFile', async (item) => {
      await treeDataProvider.viewFile(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.downloadSelected', async () => {
      await treeDataProvider.downloadSelected();
    })
  );

  context.subscriptions.push(
    treeView.onDidChangeCheckboxState((e) => {
      for (const [item, state] of e.items) {
        treeDataProvider.setCheckboxState(item, state);
      }
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
        treeDataProvider.refresh();
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
