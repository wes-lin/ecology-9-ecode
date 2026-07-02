import * as vscode from 'vscode';
import { getActiveEcodeEnvironment, getEcodeEnvironments } from './config/ecodeEnvironment';
import { EcodeNode } from './providers/ecodeNode';
import { EcodeTreeDataProvider } from './providers/treeDataProvider';

export function activate(context: vscode.ExtensionContext): void {
  const treeDataProvider = new EcodeTreeDataProvider(context.globalStorageUri.fsPath);
  const treeView = vscode.window.createTreeView('ecodeExplorer', {
    treeDataProvider,
    showCollapseAll: true,
  });
  vscode.commands.executeCommand('setContext', 'ecodeExplorer.busy', false);

  context.subscriptions.push(treeView, treeDataProvider);
  context.subscriptions.push(vscode.commands.registerCommand('ecode.refresh', () => treeDataProvider.refresh()));

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.switchEnvironment', async () => {
      const config = vscode.workspace.getConfiguration('ecode');
      const environments = getEcodeEnvironments(config);
      if (environments.length === 0) {
        const action = await vscode.window.showInformationMessage('No eCode environments configured.', 'Open Settings');
        if (action === 'Open Settings') {
          await vscode.commands.executeCommand('workbench.action.openSettings', 'ecode.environments');
        }
        return;
      }

      const activeEnvironment = getActiveEcodeEnvironment(config);
      const picked = await vscode.window.showQuickPick(
        environments.map((environment) => ({
          label: environment.name,
          description: environment.baseUrl,
          detail: `User: ${environment.username || '(empty)'} | Local: ${environment.localDir || 'src'}`,
          environment,
          picked: environment.name === activeEnvironment?.name,
        })),
        { placeHolder: 'Select eCode environment' }
      );
      if (!picked) return;

      await config.update('activeEnvironment', picked.environment.name, vscode.ConfigurationTarget.Global);
      await treeDataProvider.refresh();
    })
  );

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
    vscode.commands.registerCommand('ecode.release', (item: EcodeNode) => {
      treeDataProvider.release(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.cancelRelease', (item: EcodeNode) => {
      treeDataProvider.cancelRelease(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.setPreload', (item: EcodeNode) => {
      treeDataProvider.setPreload(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.cancelPreload', (item: EcodeNode) => {
      treeDataProvider.cancelPreload(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.setPreloadOrder', async (item: EcodeNode) => {
      await treeDataProvider.setPreloadOrder(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.createNewApp', async (item: EcodeNode) => {
      await treeDataProvider.createNewApp(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.createNewType', async (item: EcodeNode) => {
      await treeDataProvider.createNewType(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.createNewFolder', async (item: EcodeNode) => {
      await treeDataProvider.createNewFolder(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.createNewJs', async (item: EcodeNode) => {
      await treeDataProvider.createNewFile(item, 'js');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.createNewCss', async (item: EcodeNode) => {
      await treeDataProvider.createNewFile(item, 'css');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.createNewMd', async (item: EcodeNode) => {
      await treeDataProvider.createNewFile(item, 'md');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.renameItem', async (item: EcodeNode) => {
      await treeDataProvider.renameItem(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.uploadResource', async (item: EcodeNode) => {
      await treeDataProvider.uploadResource(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'ecode');
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      treeDataProvider.handleLocalFileClosed(document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('ecode.environments') || event.affectsConfiguration('ecode.activeEnvironment')) {
        treeDataProvider.refresh();
      }
    })
  );
}

export function deactivate(): void {
  // cleanup if needed
}
