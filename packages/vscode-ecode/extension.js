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
  vscode.commands.executeCommand('setContext', 'ecodeExplorer.busy', false);

  context.subscriptions.push(treeView);
  context.subscriptions.push(treeDataProvider);

  context.subscriptions.push(vscode.commands.registerCommand('ecode.refresh', () => treeDataProvider.refresh()));

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.refreshFolder', (item) => {
      treeDataProvider.refreshFolder(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.download', async () => {
      await treeDataProvider.download();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.openLocalFile', async (item) => {
      await treeDataProvider.openLocalFile(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.compareWithRemote', async (item) => {
      await treeDataProvider.compareWithRemote(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.deleteItem', async (item) => {
      await treeDataProvider.deleteItem(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.viewFile', async (item) => {
      await treeDataProvider.viewFile(item);
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
