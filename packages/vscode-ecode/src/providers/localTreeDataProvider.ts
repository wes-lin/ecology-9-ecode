import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getActiveEcodeEnvironment } from '../config/ecodeEnvironment';
import { readLocalTreeFile, writeLocalTreeFile, type EcodeLocalTreeItem } from '../config/ecodeLocalTree';
import { EcodeNode } from './ecodeNode';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeTreePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export class LocalTreeDataProvider implements vscode.TreeDataProvider<EcodeNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<EcodeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _roots: EcodeNode[] = [];
  private _loaded = false;

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  async refresh(): Promise<void> {
    this._loaded = false;
    this._roots = [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: EcodeNode): vscode.TreeItem {
    const isInfo = element.type === 'info';
    const isFile = element.type === 'file';
    const item = new vscode.TreeItem(
      element.label,
      isInfo || isFile ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed
    );
    if (isInfo) return item;

    item.resourceUri = vscode.Uri.file(this._getLocalPath(element.remotePath));
    item.tooltip = item.resourceUri.fsPath;
    item.contextValue = this._getContextValue(element);
    item.iconPath = this._getIcon(element);
    if (element.state === 'pre-state') item.description = 'P';
    if (isFile) {
      item.command = {
        command: 'ecode.local.openFile',
        title: 'Open Local File',
        arguments: [element],
      };
    }
    return item;
  }

  async getChildren(element?: EcodeNode): Promise<EcodeNode[]> {
    try {
      await this._ensureLoaded();
      if (!element) {
        if (this._roots.length > 0) return this._roots;
        const label = fs.existsSync(this._getTreePath()) ? '(empty)' : '(Run Download in the Local view to initialize)';
        return [new EcodeNode({ label, type: 'info' })];
      }
      return element.children || [];
    } catch (error) {
      return element ? [] : [new EcodeNode({ label: `Error: ${getErrorMessage(error)}`, type: 'info' })];
    }
  }

  async openFile(element: EcodeNode): Promise<void> {
    this._requireType(element, 'file');
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(this._getLocalPath(element.remotePath)), {
      preview: false,
    });
  }

  async createNewApp(parent: EcodeNode): Promise<void> {
    if (parent.businessType !== 'type' && parent.businessType !== 'project') {
      throw new Error('New app is only supported under type or project nodes.');
    }
    const name = await this._promptForName('Create Local App', 'app');
    if (!name) return;

    const appId = `local:${randomUUID()}`;
    const appPath = this._childPath(parent, name);
    const item: EcodeLocalTreeItem = {
      id: appId,
      name,
      treeType: 'folder',
      hasChild: true,
      initialAppId: appId,
      status: '',
      preStateOrder: 10000,
    };
    await this._createFolderAndNode(parent, item, appPath);
    await this.refresh();
  }

  async createNewType(parent: EcodeNode): Promise<void> {
    if (parent.businessType !== 'type') {
      throw new Error('New type is only supported under type nodes.');
    }
    const name = await this._promptForName('Create Local Type', 'type');
    if (!name) return;

    const targetPath = this._childPath(parent, name);
    await this._createFolderAndNode(
      parent,
      {
        id: `local:${randomUUID()}`,
        name,
        treeType: 'folder',
        businessType: 'type',
        hasChild: true,
      },
      targetPath
    );
    await this.refresh();
  }

  async createNewFolder(parent: EcodeNode): Promise<void> {
    this._requireType(parent, 'folder');
    const name = await this._promptForName('Create Local Folder', 'folder');
    if (!name) return;

    const targetPath = this._childPath(parent, name);
    await this._createFolderAndNode(
      parent,
      {
        id: `local:${randomUUID()}`,
        name,
        treeType: 'folder',
        hasChild: true,
      },
      targetPath
    );
    await this.refresh();
  }

  async createNewFile(parent: EcodeNode, extension: 'js' | 'css' | 'md'): Promise<void> {
    this._requireType(parent, 'folder');
    const name = await this._promptForName(
      `Create Local ${extension.toUpperCase()} File`,
      `${extension} file`,
      extension
    );
    if (!name) return;

    const targetPath = this._childPath(parent, name);
    const target = this._getLocalPath(targetPath);
    if (fs.existsSync(target)) throw new Error(`"${name}" already exists.`);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, '', 'utf8');
    await this._appendChild(parent.id, {
      id: `local:${randomUUID()}`,
      name,
      treeType: 'file',
      fileExtension: extension,
      hasChild: false,
    });
    await this.refresh();
  }

  async uploadResource(parent: EcodeNode): Promise<void> {
    if (parent.attribute !== 'resource') {
      throw new Error('Upload Resource is only supported on resource nodes.');
    }
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Add Local Resource',
    });
    const source = selected?.[0];
    if (!source) return;

    const name = path.basename(source.fsPath);
    const targetPath = this._childPath(parent, name);
    const target = vscode.Uri.file(this._getLocalPath(targetPath));
    if (fs.existsSync(target.fsPath)) throw new Error(`"${name}" already exists.`);
    await vscode.workspace.fs.copy(source, target, { overwrite: false });
    await this._appendChild(parent.id, {
      id: `local:${randomUUID()}`,
      name,
      treeType: 'file',
      fileExtension: path.extname(name).replace(/^\./, ''),
      hasChild: false,
    });
    await this.refresh();
  }

  async renameItem(element: EcodeNode): Promise<void> {
    const extension = element.type === 'file' ? this._fileExtension(element) : undefined;
    const name = await this._promptForName(
      `Rename Local ${this._kind(element)}`,
      this._kind(element),
      extension,
      element.label
    );
    if (!name || name === element.label) return;

    const oldPath = normalizeTreePath(element.remotePath);
    const newPath = normalizeTreePath(element.parent ? `${element.parent.remotePath}/${name}` : name);
    const source = vscode.Uri.file(this._getLocalPath(oldPath));
    const target = vscode.Uri.file(this._getLocalPath(newPath));
    await vscode.workspace.fs.rename(source, target, { overwrite: false });

    const tree = await this._readTreeRequired();
    const item = this._findItem(tree, element.id);
    if (!item) throw new Error('The local tree node no longer exists.');
    item.name = name;
    await writeLocalTreeFile(this._getTreePath(), tree);
    await this.refresh();
  }

  async deleteItem(element: EcodeNode): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Delete local ${this._kind(element)} "${element.label}"? It will be moved to the Recycle Bin.`,
      { modal: true },
      'Delete Local'
    );
    if (confirm !== 'Delete Local') return;

    const rootPath = normalizeTreePath(element.remotePath);
    await vscode.workspace.fs.delete(vscode.Uri.file(this._getLocalPath(rootPath)), {
      recursive: true,
      useTrash: true,
    });

    const tree = await this._readTreeRequired();
    this._removeItem(tree, element.id);
    await writeLocalTreeFile(this._getTreePath(), tree);
    await this.refresh();
  }

  async release(element: EcodeNode): Promise<void> {
    await this._writeAppNodeMetadata(element, { status: 'released' });
    await this.refresh();
  }

  async cancelRelease(element: EcodeNode): Promise<void> {
    await this._writeAppNodeMetadata(element, { status: '' });
    await this.refresh();
  }

  async setPreloadOrder(element: EcodeNode): Promise<void> {
    if (!element.appId) throw new Error('The selected node is not a configured eCode app.');
    const value = await vscode.window.showInputBox({
      title: 'Set Local App Preload Order',
      prompt: element.remotePath,
      value: String(element.appPreStateOrder || 0),
      validateInput: (input) => (/^\d+$/.test(input.trim()) ? undefined : 'Preload order must be a number.'),
    });
    if (value === undefined) return;
    await this._writeAppNodeMetadata(element, {
      preStateOrder: Number.parseInt(value.trim(), 10),
    });
    await this.refresh();
  }

  async setPreload(element: EcodeNode): Promise<void> {
    await this._setFilePreload(element, true);
  }

  async cancelPreload(element: EcodeNode): Promise<void> {
    await this._setFilePreload(element, false);
  }

  async initializeFromRemote(roots: EcodeNode[]): Promise<void> {
    const treePath = this._getTreePath();
    if (!fs.existsSync(treePath)) {
      await writeLocalTreeFile(
        treePath,
        roots.map((root) => this._serializeNode(root))
      );
    }
    await this._removeDeprecatedMetadata();
    await this.refresh();
  }

  private async _ensureLoaded(): Promise<void> {
    if (this._loaded) return;
    await this._removeDeprecatedMetadata();
    const items = (await readLocalTreeFile(this._getTreePath())) || [];
    this._roots = items.map((item) => this._mapItem(item));
    this._loaded = true;
  }

  private _mapItem(item: EcodeLocalTreeItem, parentPath = '', parent?: EcodeNode): EcodeNode {
    const name = item.name || '';
    const remotePath = normalizeTreePath(parentPath ? `${parentPath}/${name}` : name);
    const node = new EcodeNode({
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
      hasChild: Boolean(item.children?.length || item.hasChild),
      appId: item.initialAppId || (item.attribute === 'system' ? item.id : '') || '',
      attribute: item.attribute || '',
      deletable: !['system', 'jar', 'config', 'resource', 'non-code'].includes(item.attribute || ''),
      state: item.state || '',
      appStatus: item.status || '',
      appPreStateOrder: item.preStateOrder || 0,
      fileExtension: item.fileExtension || '',
      debugMode: item.debugMode,
    });
    node.children = (item.children || []).map((child) => this._mapItem(child, remotePath, node));
    return node;
  }

  private _getContextValue(element: EcodeNode): string {
    const values: string[] = [];
    if (element.type === 'folder') {
      values.push('localFolder');
      if (element.businessType === 'type' || element.businessType === 'project') {
        values.push('localCanCreateApp');
      }
      if (element.businessType === 'type') values.push('localCanCreateType');
      if (element.attribute === 'resource') values.push('localCanUploadResource');
      if (element.appId) {
        values.push('localApp', 'localCanCreateChild');
        values.push(element.appStatus === 'released' ? 'localCanCancelRelease' : 'localCanRelease');
      } else {
        values.push('localCanCreateFolder');
      }
    } else if (element.type === 'file') {
      values.push('localFile');
      if (element.id && !element.id.startsWith('local:')) values.push('localCanCompareRemote');
      if (this._findContainingAppNode(element)) {
        values.push(element.state === 'pre-state' ? 'localCanCancelPreload' : 'localCanSetPreload');
      }
    }
    if (element.deletable) values.push('localCanRename', 'localCanDelete');
    return values.join(' ');
  }

  private _getIcon(element: EcodeNode): vscode.ThemeIcon {
    if (element.type === 'file') return new vscode.ThemeIcon('file');
    if (element.debugMode === 'y') return new vscode.ThemeIcon('debug');
    if (element.businessType === 'project') return new vscode.ThemeIcon('project');
    if (element.businessType === 'type') return new vscode.ThemeIcon('symbol-folder');
    if (element.appId) {
      return new vscode.ThemeIcon(element.appStatus === 'released' ? 'vm-active' : 'vm-outline');
    }
    return new vscode.ThemeIcon('folder');
  }

  private async _setFilePreload(element: EcodeNode, enabled: boolean): Promise<void> {
    this._requireType(element, 'file');
    if (!this._findContainingAppNode(element)) {
      throw new Error('The selected file is not inside a configured eCode app.');
    }

    const tree = await this._readTreeRequired();
    const item = this._findItem(tree, element.id);
    if (!item) throw new Error('The local tree node no longer exists.');
    item.state = enabled ? 'pre-state' : '';
    await writeLocalTreeFile(this._getTreePath(), tree);
    await this.refresh();
  }

  private async _writeAppNodeMetadata(
    element: EcodeNode,
    updates: Pick<EcodeLocalTreeItem, 'status' | 'preStateOrder' | 'debugMode'>
  ): Promise<void> {
    if (!element.appId) throw new Error('The selected node is not a configured eCode app.');
    const tree = await this._readTreeRequired();
    const item = this._findItem(tree, element.id);
    if (!item) throw new Error('The local tree node no longer exists.');
    Object.assign(item, updates);
    await writeLocalTreeFile(this._getTreePath(), tree);
  }

  private _findContainingAppNode(element: EcodeNode): EcodeNode | undefined {
    let current: EcodeNode | undefined = element.type === 'file' ? element.parent : element;
    while (current) {
      if (current.appId) return current;
      current = current.parent;
    }
    return undefined;
  }

  private async _createFolderAndNode(parent: EcodeNode, item: EcodeLocalTreeItem, targetPath: string): Promise<void> {
    const target = this._getLocalPath(targetPath);
    if (fs.existsSync(target)) throw new Error(`"${item.name}" already exists.`);
    await fs.promises.mkdir(target, { recursive: false });
    await this._appendChild(parent.id, item);
  }

  private async _appendChild(parentId: string | undefined, child: EcodeLocalTreeItem): Promise<void> {
    if (!parentId) throw new Error('The parent node id is missing.');
    const tree = await this._readTreeRequired();
    const parent = this._findItem(tree, parentId);
    if (!parent) throw new Error('The parent node no longer exists.');
    parent.children = [...(parent.children || []), child];
    parent.hasChild = true;
    await writeLocalTreeFile(this._getTreePath(), tree);
  }

  private _findItem(items: EcodeLocalTreeItem[], id: string | undefined): EcodeLocalTreeItem | undefined {
    if (!id) return undefined;
    for (const item of items) {
      if (item.id === id) return item;
      const child = this._findItem(item.children || [], id);
      if (child) return child;
    }
    return undefined;
  }

  private _removeItem(items: EcodeLocalTreeItem[], id: string | undefined): boolean {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) {
      items.splice(index, 1);
      return true;
    }
    return items.some((item) => this._removeItem(item.children || [], id));
  }

  private _serializeNode(node: EcodeNode): EcodeLocalTreeItem {
    return {
      id: node.id,
      name: node.label,
      treeType: node.treeType || (node.type === 'folder' ? 'folder' : 'file'),
      businessType: node.businessType || undefined,
      hasChild: Boolean(node.children?.length),
      initialAppId: node.appId || undefined,
      attribute: node.attribute || undefined,
      state: node.state || undefined,
      status: node.appStatus || undefined,
      preStateOrder: node.appPreStateOrder || undefined,
      fileExtension: node.fileExtension || undefined,
      route: node.route || undefined,
      debugMode: node.debugMode,
      children: node.children?.map((child) => this._serializeNode(child)),
    };
  }

  private async _readTreeRequired(): Promise<EcodeLocalTreeItem[]> {
    const tree = await readLocalTreeFile(this._getTreePath());
    if (!tree) throw new Error('Run Download in the Local view to generate ecode-tree.local.json first.');
    return tree;
  }

  private _getEnvironmentRoot(): string {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) throw new Error('No workspace folder open.');
    const environment = getActiveEcodeEnvironment(vscode.workspace.getConfiguration('ecode'));
    if (!environment) throw new Error('No eCode environment configured.');
    return path.resolve(workspace, environment.localDir);
  }

  private _getSourceRoot(): string {
    return path.join(this._getEnvironmentRoot(), 'src');
  }

  private _getTreePath(): string {
    return path.join(this._getEnvironmentRoot(), '.ecode', 'ecode-tree.local.json');
  }

  private async _removeDeprecatedMetadata(): Promise<void> {
    const metadataDirectory = path.dirname(this._getTreePath());
    await Promise.all([
      fs.promises.rm(path.join(metadataDirectory, 'ecode-apps.local.json'), { force: true }),
      fs.promises.rm(path.join(metadataDirectory, 'ecode-types.json'), { force: true }),
      fs.promises.rm(path.join(metadataDirectory, 'ecode-types.local.json'), { force: true }),
    ]);
  }

  private _getLocalPath(relativePath: string): string {
    const root = path.resolve(this._getSourceRoot());
    const target = path.resolve(root, normalizeTreePath(relativePath).replace(/\//g, path.sep));
    const relative = path.relative(root, target);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`Invalid local eCode path: ${relativePath}`);
    }
    return target;
  }

  private _childPath(parent: EcodeNode, name: string): string {
    return normalizeTreePath(`${parent.remotePath}/${name}`);
  }

  private _requireType(element: EcodeNode, expected: 'folder' | 'file'): void {
    if (element.type !== expected) throw new Error(`Select a ${expected}.`);
  }

  private _kind(element: EcodeNode): string {
    if (element.businessType === 'type') return 'type';
    if (element.type === 'file') return 'file';
    if (element.appId) return 'app';
    return 'folder';
  }

  private _fileExtension(element: EcodeNode): string | undefined {
    return element.fileExtension?.replace(/^\./, '') || element.label.match(/\.([^.]+)$/)?.[1];
  }

  private async _promptForName(
    title: string,
    kind: string,
    extension?: string,
    value?: string
  ): Promise<string | undefined> {
    const picked = await vscode.window.showInputBox({
      title,
      value,
      validateInput: (input) => {
        const trimmed = input.trim();
        if (!trimmed) return `${kind} name is required.`;
        if (/[/\\]/.test(trimmed)) return `${kind} name cannot contain / or \\.`;
        if (extension && trimmed.includes('.') && !trimmed.endsWith(`.${extension}`)) {
          return `${kind} name must end with .${extension}.`;
        }
        return undefined;
      },
    });
    if (picked === undefined) return undefined;
    const trimmed = picked.trim();
    return extension && !trimmed.includes('.') ? `${trimmed}.${extension}` : trimmed;
  }
}
