import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { EcodeClient, EcodeLogger, type RemoteTreeItem } from 'ecode-sdk';
import { EcodeNode } from './ecodeNode';
import { EcodeFileSystemProvider } from './fileSystemProvider';
import { normalizeNewlines, normalizeRemotePath } from '../utils/pathUtils';
import {
  getActiveEcodeEnvironment,
  getEcodeEnvironmentError,
  getEnvironmentCookieFile,
} from '../config/ecodeEnvironment';
import { hashContent, SnapshotStore, type SnapshotEntry } from './snapshotStore';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);

type DownloadNodes = {
  folders: EcodeNode[];
  files: EcodeNode[];
};

type DownloadStats = {
  created: number;
  updated: number;
  unchanged: number;
  skippedUpdates: number;
  deleted: number;
  skippedDeletes: number;
  failed: number;
};

type DownloadFileResult = 'created' | 'updated' | 'unchanged' | 'skippedUpdates';

type DeleteResult = 'deleted' | 'unchanged' | 'skippedDeletes';

type EcodeAppConfig = {
  path: string;
  appId: string;
  appStatus: string;
  appPreStateOrder: number;
  preStateFiles: string[];
  resources: string[];
  configs: string[];
  debugMode?: 'y' | 'n';
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toBytes(content: string | Buffer): Uint8Array {
  return Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
}

function normalizeContentForWrite(content: string | Buffer): string | Buffer {
  return Buffer.isBuffer(content) ? content : normalizeNewlines(content);
}

export class EcodeTreeDataProvider implements vscode.TreeDataProvider<EcodeNode>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<EcodeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly storageRoot: string;
  private snapshotStore: SnapshotStore | null = null;
  client: EcodeClient | null = null;
  rootItems: EcodeNode[] = [];
  private _busy = false;

  // 文件内容缓存：uri → 内容字节
  _fileContents = new Map<string, Uint8Array>();
  private _fsRegistration: vscode.Disposable;

  constructor(storageRoot: string) {
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
    this.snapshotStore = null;
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

  getTreeItem(element: EcodeNode): vscode.TreeItem {
    const isInfo = element.type === 'info';
    const isFile = element.type === 'file';
    const treeItem = new vscode.TreeItem(
      element.label,
      isInfo || isFile ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed
    );

    if (!isInfo) {
      treeItem.iconPath = this._getIcon(element);
      treeItem.resourceUri = this._getRemoteUri(element);
      treeItem.contextValue = this._getContextValue(element);
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

  private _getIcon(element: EcodeNode): vscode.ThemeIcon {
    if (element.loading) return new vscode.ThemeIcon('sync~spin');
    if (element.type === 'file') return new vscode.ThemeIcon('file');
    if (element.debugMode === 'y') return new vscode.ThemeIcon('debug');
    if (element.businessType === 'project') return new vscode.ThemeIcon('project');
    if (element.businessType === 'type') return new vscode.ThemeIcon('symbol-folder');
    if (element.appId) {
      if (element.appStatus === 'released') {
        return new vscode.ThemeIcon('vm-active');
      } else {
        return new vscode.ThemeIcon('vm-outline');
      }
    }

    return new vscode.ThemeIcon('folder');
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

    if (element.hasChild) {
      const children = await this._listRemoteChildren(element);
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
      const stats = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Downloading eCode source',
          cancellable: false,
        },
        async (progress) => {
          const nodes: DownloadNodes = { folders: [], files: [] };
          const stats: DownloadStats = {
            created: 0,
            updated: 0,
            unchanged: 0,
            skippedUpdates: 0,
            deleted: 0,
            skippedDeletes: 0,
            failed: 0,
          };
          const snapshotStore = this._getSnapshotStore();
          progress.report({ message: 'Scanning remote tree...' });
          await snapshotStore.ensureLoaded();
          await this._collectDownloadNodes(undefined, nodes);

          for (const folder of nodes.folders) {
            await this._ensureLocalFolderFromRemote(folder);
          }

          await this._writeAppConfig(nodes.folders, nodes.files);

          const total = Math.max(nodes.files.length, 1);
          const increment = 100 / total;
          let completed = 0;
          for (const file of nodes.files) {
            try {
              const result = await this._downloadFileWithSnapshot(file);
              stats[result] += 1;
            } catch (error) {
              stats.failed += 1;
              console.warn(`Download failed for ${file.remotePath}: ${getErrorMessage(error)}`);
            }
            completed += 1;
            progress.report({
              increment,
              message: `Processed ${completed}/${nodes.files.length}, skipped ${stats.skippedUpdates}, failed ${stats.failed}: ${file.remotePath}`,
            });
          }

          await this._reconcileRemoteDeletes(nodes.files, stats);
          await snapshotStore.save();
          return stats;
        }
      );

      const skipped = stats.skippedUpdates + stats.skippedDeletes;
      if (stats.failed > 0 || skipped > 0) {
        vscode.window.showWarningMessage(
          `eCode download completed: ${stats.created} created, ${stats.updated} updated, ${stats.deleted} deleted, ${skipped} skipped, ${stats.failed} failed.`
        );
      } else {
        vscode.window.showInformationMessage(
          `eCode download completed: ${stats.created} created, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.deleted} deleted.`
        );
      }
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
      const content = await this._readRemoteContent(element);
      const uri = this._getRemoteUri(element);
      this._fileContents.set(uri.path, toBytes(content));

      await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
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
      const targetPath = await this._ensureLocalFileFromRemote(element, { overwrite: false });
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(targetPath), { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(`Open local file failed: ${getErrorMessage(error)}`);
    }
  }

  handleLocalFileClosed(document: vscode.TextDocument): void {
    const element = this._findNodeByLocalUri(document.uri);
    if (!element) return;

    const remoteUri = this._getRemoteUri(element);
    this._fileContents.delete(remoteUri.path);
  }

  async compareWithRemote(element: EcodeNode): Promise<void> {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    try {
      const targetPath = await this._ensureLocalFileFromRemote(element, { overwrite: false });
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
    if (element.businessType !== 'type') {
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
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Upload Resource',
    });
    const file = selected?.[0];
    if (!file) return;

    vscode.window.showInformationMessage(`Selected resource: ${file.fsPath}`);
  }

  _requireNodeId(element: EcodeNode): string {
    if (!element.id) {
      throw new Error(`${this._getNodeKindLabel(element)} id is missing.`);
    }
    return element.id;
  }

  _getNodeKindLabel(element: EcodeNode): string {
    if (element.businessType === 'type') return 'type';
    if (element.type === 'file') return 'file';
    if (element.appId) return 'app';
    return 'folder';
  }

  _getNodeFileExtension(element: EcodeNode): string | undefined {
    if (element.type !== 'file') return undefined;
    const extension = element.fileExtension?.trim().replace(/^\./, '');
    if (extension) return extension;
    const match = element.label.match(/\.([^.]+)$/);
    return match?.[1];
  }

  _normalizeName(value: string, extension?: string): string {
    const trimmed = value.trim();
    if (!extension) return trimmed;

    const normalizedExtension = extension.replace(/^\./, '');
    if (!trimmed.includes('.')) {
      return `${trimmed}.${normalizedExtension}`;
    }

    const currentExtension = trimmed.match(/\.([^.]+)$/)?.[1];
    if (currentExtension !== normalizedExtension) {
      throw new Error(`Name must end with .${normalizedExtension}.`);
    }

    return trimmed;
  }

  async _promptForName(options: {
    title: string;
    kind: string;
    value?: string;
    extension?: string;
  }): Promise<string | undefined> {
    const normalizedExtension = options.extension?.replace(/^\./, '');
    const value = await vscode.window.showInputBox({
      title: options.title,
      prompt: normalizedExtension
        ? `Enter ${options.kind} name (.${normalizedExtension} will be preserved).`
        : `Enter ${options.kind} name.`,
      value: options.value,
      validateInput: (input) => {
        const trimmed = input.trim();
        if (!trimmed) return `${options.kind} name is required.`;
        if (/[/\\]/.test(trimmed)) return `${options.kind} name cannot contain / or \\.`;
        if (normalizedExtension) {
          const hasExtension = trimmed.includes('.');
          if (hasExtension) {
            const currentExtension = trimmed.match(/\.([^.]+)$/)?.[1];
            if (currentExtension !== normalizedExtension) {
              return `${options.kind} name must end with .${normalizedExtension}.`;
            }
          }
        }
        return undefined;
      },
    });

    if (value === undefined) return undefined;
    return this._normalizeName(value, normalizedExtension);
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
      if (element.businessType === 'type') {
        values.push('canCreateNewApp', 'canCreateNewType');
      }
      if (element.attribute === 'resource') {
        values.push('canUploadResource');
      }
    }
    if (element.type === 'file') {
      values.push('canOpenLocal', 'canViewRemote', 'canCompare');
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

  async _updateAppStatus(
    app: EcodeNode,
    updates: Pick<Partial<EcodeAppConfig>, 'appStatus' | 'appPreStateOrder'>
  ): Promise<void> {
    if (updates.appStatus !== undefined) app.appStatus = updates.appStatus;
    if (updates.appPreStateOrder !== undefined) app.appPreStateOrder = updates.appPreStateOrder;
    this._onDidChangeTreeData.fire(app);

    const targetPath = this._getAppConfigPath();
    const apps = this._readAppConfig(targetPath).map((current) =>
      current.appId === app.appId ? { ...current, ...updates } : current
    );
    await writeFile(targetPath, `${JSON.stringify(apps, null, 2)}\n`);
  }

  async _updatePreloadState(element: EcodeNode, enabled: boolean): Promise<void> {
    element.state = enabled ? 'pre-state' : '';
    this._onDidChangeTreeData.fire(element);

    const parent = element.parent;
    if (!parent) return;

    const targetPath = this._getAppConfigPath();
    const relativePath = element.remotePath.slice(parent.remotePath.length + 1);
    const apps = this._readAppConfig(targetPath).map((current) => {
      if (current.path !== parent.remotePath) return current;
      const preStateFiles = enabled
        ? [...current.preStateFiles, relativePath]
        : current.preStateFiles.filter((file) => file !== relativePath);
      return { ...current, preStateFiles: [...new Set(preStateFiles)] };
    });
    await writeFile(targetPath, `${JSON.stringify(apps, null, 2)}\n`);
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
    return this._mapTree(tree, element.remotePath, element);
  }

  async _collectDownloadNodes(element: EcodeNode | undefined, nodes: DownloadNodes): Promise<void> {
    if (!element) {
      const roots = await this._listRemoteChildren(undefined);
      this.rootItems = roots;
      for (const root of roots) {
        await this._collectDownloadNodes(root, nodes);
      }
      return;
    }

    if (element.type === 'folder') {
      nodes.folders.push(element);
      const children = await this._listRemoteChildren(element);
      element.children = children;
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

  async _writeAppConfig(folders: EcodeNode[], files: EcodeNode[]): Promise<void> {
    const apps = folders
      .filter((folder) => folder.appId || folder.attribute === 'system')
      .map((folder) => this._toAppConfig(folder, files));
    const targetPath = this._getAppConfigPath();
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(apps, null, 2)}\n`);
  }

  _readAppConfig(targetPath: string): EcodeAppConfig[] {
    if (!fs.existsSync(targetPath)) return [];

    try {
      const apps = JSON.parse(fs.readFileSync(targetPath, 'utf8')) as EcodeAppConfig[];
      return Array.isArray(apps) ? apps : [];
    } catch {
      return [];
    }
  }

  _toAppConfig(app: EcodeNode, files: EcodeNode[]): EcodeAppConfig {
    return {
      path: app.remotePath,
      appId: app.appId,
      appStatus: app.appStatus || '',
      appPreStateOrder: app.appPreStateOrder || 0,
      preStateFiles: this._collectPreStateFiles(app, files),
      resources: this._collectResources(app, files),
      configs: this._collectConfigs(app, files),
      debugMode: app.debugMode,
    };
  }

  _collectPreStateFiles(app: EcodeNode, files: EcodeNode[]): string[] {
    const appPath = app.remotePath.replace(/\/$/, '');
    return files
      .filter(
        (file) =>
          (file.state === 'pre-state' || file.attribute === 'system') && file.remotePath.startsWith(`${appPath}/`)
      )
      .map((file) => file.remotePath.slice(appPath.length + 1));
  }

  _collectResources(app: EcodeNode, files: EcodeNode[]): string[] {
    const appPath = app.remotePath.replace(/\/$/, '');
    return files
      .filter((file) => file.treeType === 'resource' && file.remotePath.startsWith(`${appPath}/`))
      .map((file) => file.remotePath.slice(appPath.length + 1));
  }

  _collectConfigs(app: EcodeNode, files: EcodeNode[]): string[] {
    const appPath = app.remotePath.replace(/\/$/, '');
    return files
      .filter((file) => ['non-code', 'config'].includes(file.attribute) && file.remotePath.startsWith(`${appPath}/`))
      .map((file) => file.remotePath.slice(appPath.length + 1));
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
    const content = await this._readRemoteContent(element);
    await writeFile(targetPath, normalizeContentForWrite(content));
    return targetPath;
  }

  async _downloadFileWithSnapshot(element: EcodeNode): Promise<DownloadFileResult> {
    const targetPath = this._getLocalPath(element);
    const remoteContent = await this._readRemoteContent(element);
    const remoteHash = hashContent(remoteContent);
    const snapshotStore = this._getSnapshotStore();
    const snapshot = snapshotStore.get(element.remotePath);

    if (!fs.existsSync(targetPath)) {
      await this._writeRemoteContentToLocal(targetPath, remoteContent);
      this._setSnapshot(element, targetPath, remoteHash);
      return 'created';
    }

    const localContent = await readFile(targetPath);
    const localHash = hashContent(localContent);
    if (localHash === remoteHash) {
      this._setSnapshot(element, targetPath, remoteHash);
      return 'unchanged';
    }

    if (snapshot && localHash === snapshot.contentHash) {
      await this._writeRemoteContentToLocal(targetPath, remoteContent);
      this._setSnapshot(element, targetPath, remoteHash);
      return 'updated';
    }

    return 'skippedUpdates';
  }

  async _reconcileRemoteDeletes(files: EcodeNode[], stats: DownloadStats): Promise<void> {
    const remotePaths = new Set(files.map((file) => normalizeRemotePath(file.remotePath)));
    const snapshotStore = this._getSnapshotStore();
    for (const snapshot of snapshotStore.list()) {
      if (remotePaths.has(snapshot.remotePath)) continue;
      const result = await this._handleDeletedRemoteSnapshot(snapshot);
      stats[result] += 1;
    }
  }

  async _handleDeletedRemoteSnapshot(snapshot: SnapshotEntry): Promise<DeleteResult> {
    const localPath = this._resolveSnapshotLocalPath(snapshot);
    if (!fs.existsSync(localPath)) {
      this._getSnapshotStore().delete(snapshot.remotePath);
      return 'unchanged';
    }

    const localHash = hashContent(await readFile(localPath));
    if (localHash === snapshot.contentHash) {
      await unlink(localPath);
      this._getSnapshotStore().delete(snapshot.remotePath);
      return 'deleted';
    }

    return 'skippedDeletes';
  }

  async _writeRemoteContentToLocal(targetPath: string, content: string | Buffer): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, normalizeContentForWrite(content));
  }

  _setSnapshot(element: EcodeNode, localPath: string, contentHash: string): void {
    this._getSnapshotStore().set({
      remotePath: element.remotePath,
      localPath: this._getSnapshotLocalPath(localPath),
      contentHash,
      updatedAt: new Date().toISOString(),
    });
  }

  _getSnapshotLocalPath(localPath: string): string {
    return path.relative(this._getLocalRootPath(), localPath).replace(/\\/g, '/');
  }

  _resolveSnapshotLocalPath(snapshot: SnapshotEntry): string {
    if (path.isAbsolute(snapshot.localPath)) return snapshot.localPath;
    return path.resolve(this._getLocalRootPath(), snapshot.localPath);
  }

  async _readRemoteContent(element: EcodeNode): Promise<string | Buffer> {
    const client = this._getClient();
    if (element.treeType === 'resource') {
      return client.viewResource(element.route);
    }
    return client.viewFile(element.id ?? '');
  }

  _getWorkspaceFolderPath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      throw new Error('No workspace folder open.');
    }
    return workspaceFolder;
  }

  _getEnvironmentRootPath(): string {
    const environment = this._getActiveEnvironment();
    if (!environment) {
      throw new Error('No eCode environment configured.');
    }
    return path.resolve(this._getWorkspaceFolderPath(), environment.localDir);
  }

  _getLocalRootPath(): string {
    return path.join(this._getEnvironmentRootPath(), 'src');
  }

  _getSafeRelativeRemotePath(remotePath: string): string {
    const normalized = path.normalize(normalizeRemotePath(String(remotePath || '')));
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
    const normalizedRoot = path.resolve(localRoot).toLowerCase();
    const normalizedTarget = targetPath.toLowerCase();
    if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)) {
      throw new Error(`Invalid remote path: ${element.remotePath}`);
    }
    return targetPath;
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

  _getAppConfigPath(): string {
    return path.join(this._getEnvironmentRootPath(), '.ecode', 'ecode-apps.json');
  }

  _getSnapshotFilePath(): string {
    return path.join(this._getEnvironmentRootPath(), '.ecode', 'snapshots.json');
  }

  _getSnapshotStore(): SnapshotStore {
    if (!this.snapshotStore) {
      this.snapshotStore = new SnapshotStore(() => this._getSnapshotFilePath());
    }
    return this.snapshotStore;
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

  _mapTree(tree: RemoteTreeItem[], parentPath = '', parent?: EcodeNode): EcodeNode[] {
    if (!Array.isArray(tree)) return [];
    return tree.map((rawItem) => {
      const item = rawItem;
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
        businessType: item.businessType || '',
        parent,
        remotePath,
        route: item.route || '',
        hasChild: item.hasChild || false,
        appId: item.initialAppId || item.attribute === 'system' ? item.id : '',
        attribute: item.attribute || '',
        deletable: !['system', 'jar', 'config', 'resource', 'non-code'].includes(item.attribute || ''),
        state: item.state || '',
        appStatus: item.attribute === 'system' ? 'released' : item.status || '',
        appPreStateOrder: item.preStateOrder || 0,
        fileExtension: item.fileExtension || '',
        debugMode: item.debugMode,
      });
    });
  }
}
