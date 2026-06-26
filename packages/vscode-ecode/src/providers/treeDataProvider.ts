import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { EcodeClient, EcodeLogger } from 'ecode-sdk';
import { EcodeFileSyncStatus, EcodeNode, type RemoteTreeItem } from './ecodeNode';
import { EcodeFileSystemProvider } from './fileSystemProvider';
import { getEcodeFileStatus } from './fileStatus';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

type DownloadNodes = {
  folders: EcodeNode[];
  files: EcodeNode[];
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toText(content: string | Buffer): string {
  return Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
}

export class EcodeTreeDataProvider implements vscode.TreeDataProvider<EcodeNode>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<EcodeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly cookieFile: string;
  client: EcodeClient | null = null;
  rootItems: EcodeNode[] = [];
  private _busy = false;
  private _decorationProvider?: { refresh(uri?: vscode.Uri): void };

  // 文件内容缓存：uri → 内容字符串
  _fileContents = new Map<string, string>();
  private _fsRegistration: vscode.Disposable;

  constructor(cookieFile: string) {
    this.cookieFile = cookieFile;

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
    this._onDidChangeTreeData.dispose();
  }

  setDecorationProvider(decorationProvider: { refresh(uri?: vscode.Uri): void }): void {
    this._decorationProvider = decorationProvider;
  }

  getFileSyncStatus(uri: vscode.Uri): EcodeFileSyncStatus | undefined {
    if (uri.scheme !== 'ecode') return undefined;
    const remotePath = decodeURIComponent(uri.path).replace(/^\/+/, '');
    return this._findNodeByRemotePath(remotePath, this.rootItems)?.syncStatus;
  }

  getTreeItem(element: EcodeNode): vscode.TreeItem {
    const isInfo = element.type === 'info';
    const isFile = element.type === 'file';
    const treeItem = new vscode.TreeItem(
      element.label,
      isInfo || isFile ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed
    );

    if (!isInfo) {
      treeItem.iconPath = element.type === 'folder' ? new vscode.ThemeIcon('folder') : new vscode.ThemeIcon('file');
      treeItem.resourceUri = vscode.Uri.parse(`ecode:/${element.remotePath}`);
      treeItem.contextValue = element.deletable ? `${element.type}-deletable` : element.type;
      treeItem.tooltip = element.remotePath;
      if (element.state === 'pre-state') {
        treeItem.description = 'P';
      }
      if (element.type === 'file') {
        treeItem.command = { command: 'ecode.openLocalFile', title: 'Open Local File', arguments: [element] };
      }
    }

    return treeItem;
  }

  async getChildren(element?: EcodeNode): Promise<EcodeNode[]> {
    if (this._busy) {
      if (element?.children) return element.children;
      if (!element && this.rootItems.length > 0) return this.rootItems;
      return [];
    }

    const config = this._getConfig();
    const baseUrl = config.get('baseUrl', 'http://localhost');
    const username = config.get('username', '');
    const password = config.get('password', '');
    if (!baseUrl || baseUrl === 'http://localhost' || !username || !password) {
      return [];
    }

    const client = this._getClient();
    if (!element) {
      try {
        const tree = await client.listTree();
        this.rootItems = this._mapTree(tree, '');
        if (this.rootItems.length === 0) {
          return [new EcodeNode({ label: '(empty)', type: 'info' })];
        }
        return this.rootItems;
      } catch (error) {
        return [new EcodeNode({ label: `Error: ${getErrorMessage(error)}`, type: 'info' })];
      }
    }

    if (element.hasChild) {
      const tree =
        element.treeType === 'folder'
          ? await client.listTree(element.id ?? '', '')
          : await client.listTree('', element.id ?? '');
      const children = this._mapTree(tree, element.remotePath);
      element.children = children;
      return children;
    }

    return [];
  }

  async download(): Promise<void> {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode download is already running.');
      return;
    }

    await this._setBusy(true);
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Downloading eCode source',
          cancellable: false,
        },
        async (progress) => {
          const nodes: DownloadNodes = { folders: [], files: [] };
          progress.report({ message: 'Scanning remote eCode tree...' });
          await this._collectDownloadNodes(undefined, nodes);

          for (const folder of nodes.folders) {
            await this._ensureLocalFolderFromRemote(folder);
          }

          if (nodes.files.length === 0) {
            progress.report({ increment: 100, message: 'No files found.' });
            return;
          }

          const increment = 100 / nodes.files.length;
          let completed = 0;
          for (const file of nodes.files) {
            await this._ensureLocalFileFromRemote(file, { overwrite: true });
            completed += 1;
            progress.report({
              increment,
              message: `Downloaded ${completed}/${nodes.files.length}: ${file.remotePath}`,
            });
          }
        }
      );
      vscode.window.showInformationMessage('eCode source download completed.');
    } catch (error) {
      vscode.window.showErrorMessage(`Download failed: ${getErrorMessage(error)}`);
    } finally {
      await this._setBusy(false);
    }
  }

  async viewFile(element: EcodeNode): Promise<void> {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    try {
      const client = this._getClient();
      const content = await client.viewFile(element.id ?? '');
      const uri = vscode.Uri.parse(`ecode:/${element.remotePath}`);
      this._fileContents.set(uri.toString(), toText(content));

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(`View file failed: ${getErrorMessage(error)}`);
    }
  }

  async openLocalFile(element: EcodeNode): Promise<void> {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    try {
      const result = await this._refreshFileSyncStatus(element);

      if (result.status === 'untracked') {
        await mkdir(path.dirname(result.localPath), { recursive: true });
        await writeFile(result.localPath, result.remoteText);
      }

      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(result.localPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(`Open local file failed: ${getErrorMessage(error)}`);
    }
  }

  async handleLocalFileSaved(document: vscode.TextDocument): Promise<void> {
    const element = this._findNodeByLocalUri(document.uri);
    if (!element) return;

    try {
      await this._refreshFileSyncStatus(element);
    } catch (error) {
      vscode.window.showErrorMessage(`Refresh file status failed: ${getErrorMessage(error)}`);
    }
  }

  handleLocalFileClosed(document: vscode.TextDocument): void {
    const element = this._findNodeByLocalUri(document.uri);
    if (!element) return;

    const remoteUri = this._getRemoteUri(element);
    this._fileContents.delete(remoteUri.toString());
  }

  async compareWithRemote(element: EcodeNode): Promise<void> {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    try {
      const targetPath = await this._ensureLocalFileFromRemote(element, { overwrite: false });
      const client = this._getClient();
      const remoteContent = await client.viewFile(element.id ?? '');
      const remoteUri = vscode.Uri.from({
        scheme: 'ecode',
        path: `/${this._getSafeRelativeRemotePath(element.remotePath).replace(/\\/g, '/')}`,
        query: `compare=${Date.now()}`,
      });
      const localUri = vscode.Uri.file(targetPath);

      this._fileContents.set(remoteUri.toString(), toText(remoteContent));
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

    const confirm = await vscode.window.showWarningMessage(
      `Delete ${element.type} ${element.remotePath}?`,
      { modal: true },
      'Delete'
    );
    if (confirm !== 'Delete') return;

    vscode.window.showInformationMessage('Delete is not implemented yet.');
  }

  async _setBusy(value: boolean): Promise<void> {
    this._busy = value;
    await vscode.commands.executeCommand('setContext', 'ecodeExplorer.busy', value);
    this._onDidChangeTreeData.fire();
  }

  _getRemoteUri(element: EcodeNode): vscode.Uri {
    return vscode.Uri.parse(`ecode:/${element.remotePath}`);
  }

  async _refreshFileSyncStatus(element: EcodeNode): Promise<Awaited<ReturnType<typeof getEcodeFileStatus>>> {
    const client = this._getClient();
    const targetPath = this._getLocalPath(element);
    const result = await getEcodeFileStatus(client, targetPath, element.id ?? '');
    const remoteUri = this._getRemoteUri(element);

    this._fileContents.set(remoteUri.toString(), result.remoteText);
    element.syncStatus = result.status;
    this._onDidChangeTreeData.fire(element);
    this._decorationProvider?.refresh(remoteUri);

    return result;
  }

  _findNodeByLocalUri(uri: vscode.Uri): EcodeNode | undefined {
    if (uri.scheme !== 'file') return undefined;

    const normalizedTarget = path.normalize(uri.fsPath).toLowerCase();
    return this._findNodeByLocalPath(normalizedTarget, this.rootItems);
  }

  _findNodeByLocalPath(normalizedTarget: string, nodes: EcodeNode[]): EcodeNode | undefined {
    for (const node of nodes) {
      if (node.type === 'file') {
        try {
          if (path.normalize(this._getLocalPath(node)).toLowerCase() === normalizedTarget) {
            return node;
          }
        } catch {
          // ignore nodes with invalid remote paths
        }
      }
      if (node.children) {
        const child = this._findNodeByLocalPath(normalizedTarget, node.children);
        if (child) return child;
      }
    }
    return undefined;
  }

  _findNodeByRemotePath(remotePath: string, nodes: EcodeNode[]): EcodeNode | undefined {
    for (const node of nodes) {
      if (node.remotePath === remotePath) return node;
      if (node.children) {
        const child = this._findNodeByRemotePath(remotePath, node.children);
        if (child) return child;
      }
    }
    return undefined;
  }

  async _listRemoteChildren(element?: EcodeNode): Promise<EcodeNode[]> {
    const client = this._getClient();
    if (!element) {
      const tree = await client.listTree();
      return this._mapTree(tree, '');
    }

    const tree =
      element.treeType === 'folder'
        ? await client.listTree(element.id ?? '', '')
        : await client.listTree('', element.id ?? '');
    return this._mapTree(tree, element.remotePath);
  }

  async _collectDownloadNodes(element: EcodeNode | undefined, nodes: DownloadNodes): Promise<void> {
    if (!element) {
      const roots = await this._listRemoteChildren(undefined);
      for (const root of roots) {
        await this._collectDownloadNodes(root, nodes);
      }
      return;
    }

    if (element.type === 'folder') {
      nodes.folders.push(element);
      const children = await this._listRemoteChildren(element);
      for (const child of children) {
        await this._collectDownloadNodes(child, nodes);
      }
      return;
    }

    nodes.files.push(element);
  }

  async _ensureLocalFolderFromRemote(element: EcodeNode): Promise<string> {
    const targetPath = this._getLocalPath(element);
    await mkdir(targetPath, { recursive: true });
    return targetPath;
  }

  async _ensureLocalFileFromRemote(
    element: EcodeNode,
    { overwrite = false }: { overwrite?: boolean } = {}
  ): Promise<string> {
    const targetPath = this._getLocalPath(element);
    if (!overwrite && fs.existsSync(targetPath)) {
      return targetPath;
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    const client = this._getClient();
    const content = await client.viewFile(element.id ?? '');
    await writeFile(targetPath, toText(content));
    return targetPath;
  }

  _getWorkspaceFolderPath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      throw new Error('No workspace folder open.');
    }
    return workspaceFolder;
  }

  _getLocalRootPath(): string {
    const config = this._getConfig();
    const localDir = config.get('localDir', 'src');
    return path.resolve(this._getWorkspaceFolderPath(), localDir);
  }

  _getSafeRelativeRemotePath(remotePath: string): string {
    const normalized = path.normalize(
      String(remotePath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
    );
    if (
      !normalized ||
      path.isAbsolute(normalized) ||
      /^[a-zA-Z]:/.test(normalized) ||
      normalized === '..' ||
      normalized.startsWith(`..${path.sep}`)
    ) {
      throw new Error(`Invalid remote path: ${remotePath}`);
    }
    return normalized;
  }

  _getLocalPath(element: EcodeNode): string {
    const localRoot = this._getLocalRootPath();
    const relativePath = this._getSafeRelativeRemotePath(element.remotePath);
    const targetPath = path.resolve(localRoot, relativePath);
    const normalizedRoot = localRoot.toLowerCase();
    const normalizedTarget = targetPath.toLowerCase();
    if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)) {
      throw new Error(`Invalid remote path: ${element.remotePath}`);
    }
    return targetPath;
  }

  _getConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('ecode');
  }

  _getClient(): EcodeClient {
    if (!this.client) {
      const config = this._getConfig();
      this.client = new EcodeClient({
        baseUrl: config.get('baseUrl', 'http://localhost'),
        username: config.get('username', ''),
        password: config.get('password', ''),
        cookieFile: this.cookieFile,
        logger: new EcodeLogger({
          console: true,
          level: 'debug',
        }),
      });
    }
    return this.client;
  }

  _mapTree(tree: unknown[], parentPath = ''): EcodeNode[] {
    if (!Array.isArray(tree)) return [];
    return tree.map((rawItem) => {
      const item = rawItem as RemoteTreeItem;
      const name = item.name || '';
      const remotePath = parentPath ? `${parentPath.replace(/\/$/, '')}/${name}` : name;
      return new EcodeNode({
        id: item.id,
        label: name,
        type:
          item.treeType === 'folder' || item.businessType === 'type' || item.businessType === 'project'
            ? 'folder'
            : 'file',
        treeType: item.treeType || '',
        remotePath,
        hasChild: item.hasChild || false,
        appId: item.initialAppId || '',
        attribute: item.attribute || '',
        deletable: !['system', 'jar', 'config', 'resource', 'non-code'].includes(item.attribute || ''),
        state: item.state || '',
      });
    });
  }
}
