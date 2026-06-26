import * as path from 'node:path';
import * as vscode from 'vscode';
import { EcodeNode } from './providers/ecodeNode';
import { EcodeFileDecorationProvider } from './providers/fileDecorationProvider';
import { EcodeTreeDataProvider } from './providers/treeDataProvider';

export function activate(context: vscode.ExtensionContext): void {
  const cookieFile = path.join(context.globalStorageUri.fsPath, 'cookies.json');
  const treeDataProvider = new EcodeTreeDataProvider(cookieFile);
  const fileDecorationProvider = new EcodeFileDecorationProvider(treeDataProvider);
  treeDataProvider.setDecorationProvider(fileDecorationProvider);
  const treeView = vscode.window.createTreeView('ecodeExplorer', {
    treeDataProvider,
    showCollapseAll: true,
  });
  vscode.commands.executeCommand('setContext', 'ecodeExplorer.busy', false);

  context.subscriptions.push(treeView, treeDataProvider, vscode.window.registerFileDecorationProvider(fileDecorationProvider));
  context.subscriptions.push(vscode.commands.registerCommand('ecode.refresh', () => treeDataProvider.refresh()));

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.refreshFolder', async (item?: EcodeNode) => {
      await treeDataProvider.refreshFolder(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.download', async () => {
      await treeDataProvider.download();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.openLocalFile', async (item: EcodeNode) => {
      await treeDataProvider.openLocalFile(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.compareWithRemote', async (item: EcodeNode) => {
      await treeDataProvider.compareWithRemote(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.deleteItem', async (item: EcodeNode) => {
      await treeDataProvider.deleteItem(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.viewFile', async (item: EcodeNode) => {
      await treeDataProvider.viewFile(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'ecode');
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      treeDataProvider.handleLocalFileSaved(document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      treeDataProvider.handleLocalFileClosed(document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('ecode.baseUrl') ||
        event.affectsConfiguration('ecode.username') ||
        event.affectsConfiguration('ecode.password') ||
        event.affectsConfiguration('ecode.localDir')
      ) {
        treeDataProvider.refresh();
      }
    })
  );
}

export function deactivate(): void {
  // cleanup if needed
}
