import * as vscode from 'vscode';
import { getActiveEcodeEnvironment, getEcodeEnvironments } from './config/ecodeEnvironment';
import { EcodeNode } from './providers/ecodeNode';
import { LocalTreeDataProvider } from './providers/localTreeDataProvider';
import { EcodeTreeDataProvider } from './providers/treeDataProvider';
import { getErrorMessage } from './utils/errors';

export function activate(context: vscode.ExtensionContext): void {
  const treeDataProvider = new EcodeTreeDataProvider(context.globalStorageUri.fsPath);
  const localTreeDataProvider = new LocalTreeDataProvider();
  const remoteTreeView = vscode.window.createTreeView('ecodeExplorer', {
    treeDataProvider,
    showCollapseAll: true,
  });
  const localTreeView = vscode.window.createTreeView('ecodeLocalExplorer', {
    treeDataProvider: localTreeDataProvider,
    showCollapseAll: true,
  });
  const refreshLocalTree = (uri?: vscode.Uri): void => {
    localTreeDataProvider.reloadFromTree(uri?.fsPath).catch((error) => {
      vscode.window.showErrorMessage(`Refresh local eCode metadata failed: ${getErrorMessage(error)}`);
    });
  };
  vscode.commands.executeCommand('setContext', 'ecodeExplorer.busy', false);

  context.subscriptions.push(remoteTreeView, localTreeView, treeDataProvider, localTreeDataProvider);
  context.subscriptions.push(vscode.commands.registerCommand('ecode.refresh', () => treeDataProvider.refresh()));
  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.local.refresh', () => localTreeDataProvider.reloadFromTree())
  );

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
      await localTreeDataProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.refreshFolder', async (item?: EcodeNode) => {
      await treeDataProvider.refreshFolder(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecode.download', async () => {
      const downloaded = await treeDataProvider.download();
      if (downloaded) await localTreeDataProvider.reloadFromTree();
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

  const registerLocalCommand = (command: string, operation: (item: EcodeNode) => Promise<void>): vscode.Disposable =>
    vscode.commands.registerCommand(command, async (item?: EcodeNode) => {
      if (!item) {
        vscode.window.showWarningMessage('Select a node in the Local eCode view.');
        return;
      }
      try {
        await operation(item);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Local eCode operation failed: ${message}`);
      }
    });

  context.subscriptions.push(
    registerLocalCommand('ecode.local.openFile', (item) => localTreeDataProvider.openFile(item)),
    registerLocalCommand('ecode.local.createNewApp', (item) => localTreeDataProvider.createNewApp(item)),
    registerLocalCommand('ecode.local.createNewType', (item) => localTreeDataProvider.createNewType(item)),
    registerLocalCommand('ecode.local.createNewFolder', (item) => localTreeDataProvider.createNewFolder(item)),
    registerLocalCommand('ecode.local.createNewJs', (item) => localTreeDataProvider.createNewFile(item, 'js')),
    registerLocalCommand('ecode.local.createNewCss', (item) => localTreeDataProvider.createNewFile(item, 'css')),
    registerLocalCommand('ecode.local.createNewMd', (item) => localTreeDataProvider.createNewFile(item, 'md')),
    registerLocalCommand('ecode.local.uploadResource', (item) => localTreeDataProvider.uploadResource(item)),
    registerLocalCommand('ecode.local.renameItem', (item) => localTreeDataProvider.renameItem(item)),
    registerLocalCommand('ecode.local.deleteItem', (item) => localTreeDataProvider.deleteItem(item)),
    registerLocalCommand('ecode.local.release', (item) => localTreeDataProvider.release(item)),
    registerLocalCommand('ecode.local.cancelRelease', (item) => localTreeDataProvider.cancelRelease(item)),
    registerLocalCommand('ecode.local.setPreload', (item) => localTreeDataProvider.setPreload(item)),
    registerLocalCommand('ecode.local.cancelPreload', (item) => localTreeDataProvider.cancelPreload(item)),
    registerLocalCommand('ecode.local.setPreloadOrder', (item) => localTreeDataProvider.setPreloadOrder(item))
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      treeDataProvider.handleRemoteFileClosed(document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('ecode.environments') || event.affectsConfiguration('ecode.activeEnvironment')) {
        treeDataProvider.refresh();
        refreshLocalTree();
      }
    })
  );

  const localMetadataWatcher = vscode.workspace.createFileSystemWatcher('**/.ecode/ecode-tree.json');
  context.subscriptions.push(
    localMetadataWatcher,
    localMetadataWatcher.onDidCreate(refreshLocalTree),
    localMetadataWatcher.onDidChange(refreshLocalTree),
    localMetadataWatcher.onDidDelete(refreshLocalTree)
  );
  refreshLocalTree();
}

export function deactivate(): void {
  // cleanup if needed
}
