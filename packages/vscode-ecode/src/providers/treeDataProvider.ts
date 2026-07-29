import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { EcodeClient, EcodeLogger } from 'ecode-sdk';
import { EcodeNode } from './ecodeNode';
import { EcodeFileSystemProvider } from './fileSystemProvider';
import { getErrorMessage } from '../utils/errors';
import { getSafeRelativeTreePath, resolveTreePath } from '../utils/pathUtils';
import {
  getActiveEcodeEnvironment,
  getActiveEcodeEnvironmentRoot,
  getEcodeEnvironmentError,
  getEnvironmentCookieFile,
} from '../config/ecodeEnvironment';
import { BaseEcodeTreeDataProvider, type EcodeTreeItemPresentation } from './baseTreeDataProvider';

function toBytes(content: string | Buffer): Uint8Array {
  return Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
}

export class EcodeTreeDataProvider extends BaseEcodeTreeDataProvider {
  readonly storageRoot: string;
  client: EcodeClient | null = null;
  rootItems: EcodeNode[] = [];
  private _busy = false;
  private readonly _output = vscode.window.createOutputChannel('eCode');

  // 文件内容缓存：uri → 内容字节
  _fileContents = new Map<string, Uint8Array>();
  private _fsRegistration: vscode.Disposable;

  constructor(storageRoot: string) {
    super();
    this.storageRoot = storageRoot;

    // 注册只读 FileSystemProvider（提供面包屑等原生功能）
    const fileSystemProvider = new EcodeFileSystemProvider(this);
    this._fsRegistration = vscode.workspace.registerFileSystemProvider('ecode', fileSystemProvider, {
      isCaseSensitive: false,
      isReadonly: true,
    });
  }

  async refresh(): Promise<void> {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    this.client = null;
    this.rootItems = [];
    this._fileContents.clear();
    this._onDidChangeTreeData.fire();
  }

  async refreshFolder(element?: EcodeNode): Promise<void> {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    if (!element) {
      await this.refresh();
      return;
    }

    try {
      element.children = await this._listRemoteChildren(element);
      this._onDidChangeTreeData.fire(element);
    } catch (error) {
      vscode.window.showErrorMessage(`Refresh folder failed: ${getErrorMessage(error)}`);
    }
  }

  dispose(): void {
    this._fsRegistration.dispose();
    this._output.dispose();
    super.dispose();
  }

  protected _getTreeItemPresentation(element: EcodeNode): EcodeTreeItemPresentation {
    return {
      resourceUri: this._getRemoteUri(element),
      contextValue: this._getContextValue(element),
      tooltip: element.remotePath,
      fileCommand: {
        command: 'ecode.viewFile',
        title: 'View Remote File',
        arguments: [element],
      },
    };
  }

  async getChildren(element?: EcodeNode): Promise<EcodeNode[]> {
    if (this._busy) {
      if (element?.children) return element.children;
      if (!element && this.rootItems.length > 0) return this.rootItems;
      return [];
    }

    const configError = this._getActiveEnvironmentError();
    if (configError) {
      return element ? [] : [new EcodeNode({ label: configError, type: 'info' })];
    }

    if (!element) {
      try {
        this.rootItems = await this._listRemoteChildren();
        if (this.rootItems.length === 0) {
          return [new EcodeNode({ label: '(empty)', type: 'info' })];
        }
        return this.rootItems;
      } catch (error) {
        return [new EcodeNode({ label: `Error: ${getErrorMessage(error)}`, type: 'info' })];
      }
    }

    if (element.type !== 'folder') return [];
    if (element.children !== undefined) return element.children;

    const children = await this._listRemoteChildren(element);
    element.children = children;
    element.hasChild = children.length > 0;
    return children;
  }

  async download(): Promise<boolean> {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode download is already running.');
      return false;
    }

    let outcome: Awaited<ReturnType<EcodeClient['download']>> | undefined;
    let downloadError: unknown;

    try {
      await this._setBusy(true);
      const client = this._getClient();
      outcome = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Downloading eCode source',
          cancellable: false,
        },
        async (progress) => {
          return client.download(this._getEnvironmentRootPath(), {
            onProgress: (state) => {
              if (state.phase === 'tree') {
                progress.report({ message: 'Scanning remote tree...' });
                return;
              }
              if (state.total === 0) {
                progress.report({ message: 'No files found.' });
                return;
              }
              progress.report({
                message: `Processed ${state.completed}/${state.total}: ${state.relativePath || ''}`,
              });
            },
          });
        }
      );
    } catch (error) {
      downloadError = error;
    } finally {
      await this._setBusy(false);
    }

    if (downloadError !== undefined || !outcome) {
      vscode.window.showErrorMessage(`Download failed: ${getErrorMessage(downloadError)}`);
      return false;
    }

    this.rootItems = this._mapTreeItems(outcome.tree, '');
    this._onDidChangeTreeData.fire();

    if (outcome.failures.length > 0) {
      this._output.appendLine(`[${new Date().toISOString()}] eCode file download failures`);
      for (const failure of outcome.failures) {
        this._output.appendLine(`- ${failure.relativePath}: ${failure.message}`);
      }
      this._output.appendLine('');
    }

    const summary = `${outcome.downloaded} new file(s), ${outcome.skipped} existing file(s) kept`;
    if (outcome.failed > 0) {
      const message = `eCode download completed: ${summary}; ${outcome.failed} file download failure(s).`;
      const action = await vscode.window.showWarningMessage(message, 'Show Details');
      if (action === 'Show Details') {
        this._output.show(true);
      }
    } else {
      vscode.window.showInformationMessage(`eCode download completed: ${summary}.`);
    }
    return true;
  }

  async viewFile(element: EcodeNode): Promise<void> {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    try {
      const content = await this._readRemoteContent(element);
      const uri = this._getRemoteUri(element);
      this._fileContents.set(uri.path, toBytes(content));

      await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(`View file failed: ${getErrorMessage(error)}`);
    }
  }

  handleRemoteFileClosed(document: vscode.TextDocument): void {
    if (document.uri.scheme === 'ecode') {
      this._fileContents.delete(document.uri.path);
    }
  }

  async compareWithRemote(element: EcodeNode): Promise<void> {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    try {
      if (element.type !== 'file') throw new Error('Select a local file.');
      const targetPath = this._getLocalPath(element);
      if (!fs.existsSync(targetPath)) throw new Error(`Local file does not exist: ${targetPath}`);
      const remoteContent = await this._readRemoteContent(element);
      const safePath = `/${this._getSafeRelativeRemotePath(element.remotePath).replace(/\\/g, '/')}`;
      const remoteUri = vscode.Uri.from({
        scheme: 'ecode',
        path: safePath,
        query: `side=remote&compare=${Date.now()}`,
      });
      const localUri = vscode.Uri.file(targetPath);

      this._fileContents.set(remoteUri.path, toBytes(remoteContent));
      await vscode.commands.executeCommand('vscode.diff', remoteUri, localUri, `${element.label}: Remote ↔ Local`);
    } catch (error) {
      vscode.window.showErrorMessage(`Compare failed: ${getErrorMessage(error)}`);
    }
  }

  async deleteItem(element: EcodeNode): Promise<void> {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    if (!element.deletable) {
      vscode.window.showWarningMessage('Only items with deletable=true can be deleted.');
      return;
    }

    const kind = this._getNodeKindLabel(element);
    const confirm = await vscode.window.showWarningMessage(
      `Delete ${kind} "${element.label}"?`,
      { modal: true },
      'Delete'
    );
    if (confirm !== 'Delete') return;

    const client = this._getClient();
    await this._withNodeLoading(element, async () => {
      try {
        if (element.businessType === 'type') {
          await client.deleteType(this._requireNodeId(element));
        } else if (element.type === 'file') {
          await client.deleteFile(this._requireNodeId(element));
        } else {
          await client.deleteFolder(this._requireNodeId(element));
        }
        await this._refreshStructuralParent(element);
      } catch (error) {
        vscode.window.showErrorMessage(`Delete ${kind} failed: ${getErrorMessage(error)}`);
      }
    });
  }

  async release(element: EcodeNode): Promise<void> {
    const client = this._getClient();
    await this._withNodeLoading(element, async () => {
      try {
        await client.release(element.appId);
        await this._updateAppStatus(element, { appStatus: 'released' });
      } catch (e) {
        vscode.window.showErrorMessage(`${element.label} release fail, error:${e}`);
      }
    });
  }

  async cancelRelease(element: EcodeNode): Promise<void> {
    const client = this._getClient();
    await this._withNodeLoading(element, async () => {
      try {
        await client.deleteReleaseFile(element.appId);
        await this._updateAppStatus(element, { appStatus: '' });
      } catch (e) {
        vscode.window.showErrorMessage(`${element.label} cancel release fail, error:${e}`);
      }
    });
  }

  async setPreload(element: EcodeNode): Promise<void> {
    const client = this._getClient();
    await this._withNodeLoading(element, async () => {
      try {
        await client.markFile(element.id as string, 'pre-state');
        await this._updatePreloadState(element, true);
      } catch (e) {
        vscode.window.showErrorMessage(`${element.label} set preload fail, error:${e}`);
      }
    });
  }

  async cancelPreload(element: EcodeNode): Promise<void> {
    const client = this._getClient();
    await this._withNodeLoading(element, async () => {
      try {
        await client.markFile(element.id as string);
        await this._updatePreloadState(element, false);
      } catch (e) {
        vscode.window.showErrorMessage(`${element.label} cancel preload  fail, error:${e}`);
      }
    });
  }

  async setPreloadOrder(element: EcodeNode): Promise<void> {
    const value = await vscode.window.showInputBox({
      title: 'Set Preload Order',
      prompt: `App ID: ${element.appId} | Folder: ${element.label}`,
      value: String(element.appPreStateOrder || 0),
      validateInput: (input) => (/^\d+$/.test(input.trim()) ? undefined : 'Preload order must be a number.'),
    });
    if (value === undefined) return;

    const client = this._getClient();
    await this._withNodeLoading(element, async () => {
      try {
        const appPreStateOrder = Number.parseInt(value.trim(), 10);
        await client.setPreStateOrder(element.appId, appPreStateOrder);
        await this._updateAppStatus(element, { appPreStateOrder });
      } catch (e) {
        vscode.window.showErrorMessage(`${element.label} Set preload order  fail, error:${e}`);
      }
    });
  }

  async createNewApp(element: EcodeNode): Promise<void> {
    if (element.businessType !== 'type' && element.businessType !== 'project') {
      vscode.window.showWarningMessage('New app is only supported under type nodes.');
      return;
    }

    const name = await this._promptForName({ title: 'Create New App', kind: 'app' });
    if (!name) return;

    const client = this._getClient();
    await this._withNodeLoading(element, async () => {
      try {
        await client.addFolder(name, undefined, this._requireNodeId(element));
        await this.refreshFolder(element);
      } catch (error) {
        vscode.window.showErrorMessage(`Create app failed: ${getErrorMessage(error)}`);
      }
    });
  }

  async createNewType(element: EcodeNode): Promise<void> {
    if (element.businessType !== 'type') {
      vscode.window.showWarningMessage('New type is only supported under type nodes.');
      return;
    }

    const name = await this._promptForName({ title: 'Create New Type', kind: 'type' });
    if (!name) return;

    const client = this._getClient();
    await this._withNodeLoading(element, async () => {
      try {
        await client.addType(name, this._requireNodeId(element));
        await this.refreshFolder(element);
      } catch (error) {
        vscode.window.showErrorMessage(`Create type failed: ${getErrorMessage(error)}`);
      }
    });
  }

  async createNewFolder(element: EcodeNode): Promise<void> {
    if (element.type !== 'folder') {
      vscode.window.showWarningMessage('New folder is only supported under folder nodes.');
      return;
    }

    const name = await this._promptForName({ title: 'Create New Folder', kind: 'folder' });
    if (!name) return;

    const client = this._getClient();
    await this._withNodeLoading(element, async () => {
      try {
        await client.addFolder(name, this._requireNodeId(element));
        await this.refreshFolder(element);
      } catch (error) {
        vscode.window.showErrorMessage(`Create folder failed: ${getErrorMessage(error)}`);
      }
    });
  }

  async createNewFile(element: EcodeNode, extension: 'js' | 'css' | 'md'): Promise<void> {
    if (element.type !== 'folder') {
      vscode.window.showWarningMessage(`New ${extension.toUpperCase()} file is only supported under folder nodes.`);
      return;
    }

    const name = await this._promptForName({
      title: `Create New ${extension.toUpperCase()} File`,
      kind: `${extension} file`,
      extension,
    });
    if (!name) return;

    const client = this._getClient();
    await this._withNodeLoading(element, async () => {
      try {
        await client.addFile(this._requireNodeId(element), name, extension);
        await this.refreshFolder(element);
      } catch (error) {
        vscode.window.showErrorMessage(`Create ${extension.toUpperCase()} file failed: ${getErrorMessage(error)}`);
      }
    });
  }

  async renameItem(element: EcodeNode): Promise<void> {
    const kind = this._getNodeKindLabel(element);
    const extension = element.type === 'file' ? this._getNodeFileExtension(element) : undefined;
    const name = await this._promptForName({
      title: `Rename ${kind}`,
      kind,
      value: element.label,
      extension,
    });
    if (!name) return;

    const client = this._getClient();
    await this._withNodeLoading(element, async () => {
      try {
        if (element.businessType === 'type') {
          await client.updateTypeName(this._requireNodeId(element), name);
        } else if (element.type === 'file') {
          await client.updateFileName(this._requireNodeId(element), name);
        } else {
          await client.updateFolderName(this._requireNodeId(element), name);
        }
        await this._refreshStructuralParent(element);
      } catch (error) {
        vscode.window.showErrorMessage(`Rename ${kind} failed: ${getErrorMessage(error)}`);
      }
    });
  }

  async uploadResource(element: EcodeNode): Promise<void> {
    if (element.type !== 'folder' || element.attribute !== 'resource') {
      vscode.window.showWarningMessage('Upload Resource is only supported on resource folders.');
      return;
    }

    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Upload Resource',
      title: `Upload Resource to ${element.label}`,
    });
    const file = selected?.[0];
    if (!file) return;

    const client = this._getClient();
    const folderId = this._requireNodeId(element);
    const fileName = path.basename(file.fsPath);
    await this._withNodeLoading(element, async () => {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Uploading ${fileName}`,
            cancellable: false,
          },
          async () => {
            const response = await client.uploadFile(file.fsPath, folderId);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
            }
          }
        );
        await this.refreshFolder(element);
        vscode.window.showInformationMessage(`Resource "${fileName}" uploaded.`);
      } catch (error) {
        vscode.window.showErrorMessage(`Upload resource "${fileName}" failed: ${getErrorMessage(error)}`);
      }
    });
  }

  _requireNodeId(element: EcodeNode): string {
    if (!element.id) {
      throw new Error(`${this._getNodeKindLabel(element)} id is missing.`);
    }
    return element.id;
  }

  async _refreshStructuralParent(element: EcodeNode): Promise<void> {
    if (element.parent) {
      await this.refreshFolder(element.parent);
      return;
    }
    await this.refresh();
  }

  async _withNodeLoading(element: EcodeNode, operation: () => Promise<void>): Promise<void> {
    element.loading = true;
    this._onDidChangeTreeData.fire(element);
    try {
      await operation();
    } finally {
      element.loading = false;
      this._onDidChangeTreeData.fire(element);
    }
  }

  async _setBusy(value: boolean): Promise<void> {
    this._busy = value;
    await vscode.commands.executeCommand('setContext', 'ecodeExplorer.busy', value);
    this._onDidChangeTreeData.fire();
  }

  _getContextValue(element: EcodeNode): string {
    const values: string[] = [];

    if (element.type === 'folder') {
      values.push('canRefreshFolder');
      if (element.businessType === 'type' || element.businessType === 'project') {
        values.push('canCreateNewApp', 'canCreateNewType');
      }
      if (element.attribute === 'resource') {
        values.push('canUploadResource');
      }
    }
    if (element.type === 'file') {
      values.push('canViewRemote');
      if (element.deletable) {
        if (element.state === 'pre-state') {
          values.push('canCancelPreload');
        } else {
          values.push('canSetScriptPreload');
        }
      }
    }
    if (element.deletable) {
      values.push('canDelete', 'canRename');
    }
    if (element.appId) {
      values.push('canCreateNewFolder', 'canCreateNewJs', 'canCreateNewCss', 'canCreateNewMd');
      if (element.deletable) {
        values.push('canSetPreloadOrder');
        if (element.appStatus === 'released') {
          values.push('canCancelRelease');
        } else {
          values.push('canRelease');
        }
      }
    }

    return values.join(' ');
  }

  _getRemoteUri(element: EcodeNode): vscode.Uri {
    return vscode.Uri.parse(`ecode:/${element.remotePath}`);
  }

  async _updateAppStatus(app: EcodeNode, updates: Pick<EcodeNode, 'appStatus' | 'appPreStateOrder'>): Promise<void> {
    if (updates.appStatus !== undefined) app.appStatus = updates.appStatus;
    if (updates.appPreStateOrder !== undefined) app.appPreStateOrder = updates.appPreStateOrder;
    this._onDidChangeTreeData.fire(app);
  }

  async _updatePreloadState(element: EcodeNode, enabled: boolean): Promise<void> {
    element.state = enabled ? 'pre-state' : '';
    this._onDidChangeTreeData.fire(element);
  }

  async _listRemoteChildren(element?: EcodeNode): Promise<EcodeNode[]> {
    const client = this._getClient();
    if (!element) {
      const tree = await client.listTree();
      return this._mapTreeItems(tree, '');
    }

    const tree =
      element.treeType === 'folder'
        ? await client.listTree(element.id ?? '', '')
        : await client.listTree('', element.id ?? '');
    return this._mapTreeItems(tree, element.remotePath, element);
  }

  async _readRemoteContent(element: EcodeNode): Promise<string | Buffer> {
    const client = this._getClient();
    if (element.treeType === 'resource') {
      return client.viewResource(element.route);
    }
    return client.viewFile(element.id ?? '');
  }

  _getEnvironmentRootPath(): string {
    return getActiveEcodeEnvironmentRoot(this._getConfig());
  }

  _getLocalRootPath(): string {
    return path.join(this._getEnvironmentRootPath(), 'src');
  }

  _getSafeRelativeRemotePath(remotePath: string): string {
    return getSafeRelativeTreePath(remotePath, 'remote path');
  }

  _getLocalPath(element: EcodeNode): string {
    return resolveTreePath(this._getLocalRootPath(), element.remotePath, 'remote path');
  }

  _getConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('ecode');
  }

  _getActiveEnvironment() {
    return getActiveEcodeEnvironment(this._getConfig());
  }

  _getActiveEnvironmentError(): string | undefined {
    return getEcodeEnvironmentError(this._getActiveEnvironment());
  }

  _getClient(): EcodeClient {
    if (!this.client) {
      const environment = this._getActiveEnvironment();
      if (!environment) {
        throw new Error('No eCode environment configured.');
      }
      this.client = new EcodeClient({
        baseUrl: environment.baseUrl,
        username: environment.username,
        password: environment.password,
        cookieFile: getEnvironmentCookieFile(this.storageRoot, environment),
        logger: new EcodeLogger({
          console: true,
          level: 'debug',
        }),
      });
    }
    return this.client;
  }
}
