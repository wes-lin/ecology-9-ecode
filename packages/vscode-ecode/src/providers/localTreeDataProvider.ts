import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  buildAppUpgradePackage,
  collectEcodeAppConfigs,
  publishAppUpgradePackage,
  synchronizeEcodeAppConfigs,
} from 'ecode-sdk';
import { getActiveEcodeEnvironmentRoot } from '../config/ecodeEnvironment';
import { readLocalTreeFile, writeLocalTreeFile, type EcodeLocalTreeItem } from '../config/ecodeLocalTree';
import { ActiveEcodeClientProvider } from '../utils/ecodeClientFactory';
import { getErrorMessage } from '../utils/errors';
import { createEcodeId, createLocalNodeId, isLocalNodeId } from '../utils/localNodeId';
import { normalizeTreePath, resolveTreePath } from '../utils/pathUtils';
import { BaseEcodeTreeDataProvider, type EcodeTreeItemPresentation } from './baseTreeDataProvider';
import { EcodeNode } from './ecodeNode';

export class LocalTreeDataProvider extends BaseEcodeTreeDataProvider {
  private readonly _clientProvider: ActiveEcodeClientProvider;
  private _roots: EcodeNode[] = [];
  private _loaded = false;
  private _reloadQueue: Promise<void> = Promise.resolve();
  private _publishing = false;
  private _publishSelectionActive = false;
  private readonly _publishSelectionAppIds = new Set<string>();
  private readonly _selectedPublishAppIds = new Set<string>();
  private readonly _publishAppIdsByNode = new Map<EcodeNode, string[]>();

  constructor(storageRoot: string, clientProvider = new ActiveEcodeClientProvider(storageRoot)) {
    super();
    this._clientProvider = clientProvider;
  }

  async refresh(): Promise<void> {
    this._loaded = false;
    this._roots = [];
    this._onDidChangeTreeData.fire();
  }

  async reloadFromTree(changedTreePath?: string): Promise<void> {
    this._reloadQueue = this._reloadQueue
      .catch(() => undefined)
      .then(async () => {
        let treePath: string;
        try {
          treePath = this._getTreePath();
        } catch {
          await this.refresh();
          return;
        }

        if (changedTreePath && !this._isSamePath(treePath, changedTreePath)) return;

        await synchronizeEcodeAppConfigs(treePath);
        this._loaded = false;
        this._roots = [];
        await this._ensureLoaded();
        await this._materializeFolders(this._roots);
        this._onDidChangeTreeData.fire();
      });
    return this._reloadQueue;
  }

  protected _getTreeItemPresentation(element: EcodeNode): EcodeTreeItemPresentation {
    const resourceUri = vscode.Uri.file(this._getLocalPath(element.remotePath));
    return {
      resourceUri,
      tooltip: resourceUri.fsPath,
      contextValue: this._getContextValue(element),
      fileCommand: {
        command: 'ecode.local.openFile',
        title: 'Open Local File',
        arguments: [element],
      },
    };
  }

  getTreeItem(element: EcodeNode): vscode.TreeItem {
    const item = super.getTreeItem(element);
    if (this._publishSelectionActive) {
      item.contextValue = 'localPublishSelection';
      item.command = undefined;
    }
    const appIds = this._getPublishAppIds(element);
    if (appIds.length === 0) return item;

    const selectedCount = appIds.filter((appId) => this._selectedPublishAppIds.has(appId)).length;
    item.checkboxState =
      selectedCount === appIds.length ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;

    const isApp = Boolean(element.appId && this._publishSelectionAppIds.has(element.appId));
    if (!isApp) {
      item.description = selectedCount > 0 ? `${selectedCount}/${appIds.length} selected` : `${appIds.length} apps`;
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
    const name = await this._promptForName({ title: 'Create Local App', kind: 'app' });
    if (!name) return;

    const appId = createEcodeId();
    const appPath = this._childPath(parent, name);
    const item: EcodeLocalTreeItem = {
      id: appId,
      name,
      treeType: 'folder',
      hasChild: true,
      initialAppId: appId,
      status: '',
      preStateOrder: 10000,
      children: [
        {
          id: createLocalNodeId(),
          name: 'config',
          treeType: 'folder',
          attribute: 'config',
          hasChild: true,
          children: [
            {
              id: createLocalNodeId(),
              name: 'configLoad.js',
              treeType: 'file',
              attribute: 'config',
              fileExtension: 'js',
              hasChild: false,
            },
            {
              id: createLocalNodeId(),
              name: 'configLoad_default.js',
              treeType: 'file',
              attribute: 'non-code',
              fileExtension: 'js',
              hasChild: false,
            },
            {
              id: createLocalNodeId(),
              name: 'config_default.json',
              treeType: 'file',
              attribute: 'non-code',
              fileExtension: 'json',
              hasChild: false,
            },
            {
              id: createLocalNodeId(),
              name: 'config.js',
              treeType: 'file',
              attribute: 'config',
              fileExtension: 'js',
              state: 'pre-state',
              hasChild: false,
            },
            {
              id: createLocalNodeId(),
              name: 'config.json',
              treeType: 'file',
              attribute: 'non-code',
              fileExtension: 'json',
              hasChild: false,
            },
            {
              id: createLocalNodeId(),
              name: 'config_default.js',
              treeType: 'file',
              attribute: 'non-code',
              fileExtension: 'js',
              state: 'pre-state',
              hasChild: false,
            },
          ],
        },
        {
          id: createLocalNodeId(),
          name: 'jar',
          treeType: 'folder',
          attribute: 'jar',
          hasChild: false,
        },
        {
          id: createLocalNodeId(),
          name: 'resources',
          treeType: 'folder',
          attribute: 'resource',
          hasChild: false,
        },
      ],
    };
    await this._createFolderAndNode(parent, item, appPath);
    await this.refresh();
  }

  async createNewType(parent: EcodeNode): Promise<void> {
    if (parent.businessType !== 'type') {
      throw new Error('New type is only supported under type nodes.');
    }
    const name = await this._promptForName({ title: 'Create Local Type', kind: 'type' });
    if (!name) return;

    const targetPath = this._childPath(parent, name);
    await this._createFolderAndNode(
      parent,
      {
        id: createEcodeId(),
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
    const name = await this._promptForName({ title: 'Create Local Folder', kind: 'folder' });
    if (!name) return;

    const targetPath = this._childPath(parent, name);
    await this._createFolderAndNode(
      parent,
      {
        id: createLocalNodeId(),
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
    const name = await this._promptForName({
      title: `Create Local ${extension.toUpperCase()} File`,
      kind: `${extension} file`,
      extension,
    });
    if (!name) return;

    const targetPath = this._childPath(parent, name);
    const target = this._getLocalPath(targetPath);
    if (fs.existsSync(target)) throw new Error(`"${name}" already exists.`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '', 'utf8');
    await this._appendChild(parent.id, {
      id: createLocalNodeId(),
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
      id: createLocalNodeId(),
      name,
      treeType: 'file',
      fileExtension: path.extname(name).replace(/^\./, ''),
      hasChild: false,
    });
    await this.refresh();
  }

  get isPublishSelectionActive(): boolean {
    return this._publishSelectionActive;
  }

  async startPublishAppsSelection(): Promise<boolean> {
    if (this._publishing) {
      vscode.window.showWarningMessage('Local eCode publish is already running.');
      return false;
    }
    if (this._publishSelectionActive) return true;

    await this._ensureLoaded();
    this._selectedPublishAppIds.clear();
    this._rebuildPublishSelectionIndex();
    if (this._publishSelectionAppIds.size === 0) {
      vscode.window.showInformationMessage('No local eCode apps are available to publish.');
      return false;
    }

    this._publishSelectionActive = true;
    await vscode.commands.executeCommand('setContext', 'ecodeLocalExplorer.publishSelection', true);
    this._onDidChangeTreeData.fire();
    return true;
  }

  async cancelPublishAppsSelection(): Promise<void> {
    if (!this._publishSelectionActive) return;
    this._publishSelectionActive = false;
    this._publishSelectionAppIds.clear();
    this._selectedPublishAppIds.clear();
    this._publishAppIdsByNode.clear();
    await vscode.commands.executeCommand('setContext', 'ecodeLocalExplorer.publishSelection', false);
    this._onDidChangeTreeData.fire();
  }

  handlePublishCheckboxChange(items: ReadonlyArray<[EcodeNode, vscode.TreeItemCheckboxState]>): void {
    if (!this._publishSelectionActive) return;
    for (const [element, state] of items) {
      const appIds = this._getPublishAppIds(element);
      for (const appId of appIds) {
        if (state === vscode.TreeItemCheckboxState.Checked) this._selectedPublishAppIds.add(appId);
        else this._selectedPublishAppIds.delete(appId);
      }
    }
    this._onDidChangeTreeData.fire();
  }

  async publishSelectedApps(): Promise<boolean> {
    if (!this._publishSelectionActive) return false;
    if (this._publishing) {
      vscode.window.showWarningMessage('Local eCode publish is already running.');
      return false;
    }

    const projectRoot = this._getEnvironmentRoot();
    const tree = (await readLocalTreeFile(this._getTreePath())) || [];
    const appConfigs = collectEcodeAppConfigs(tree);
    const appConfigsById = new Map(appConfigs.map((app) => [app.appId, app]));
    const selectedAppIds = Array.from(this._selectedPublishAppIds).filter((appId) => appConfigsById.has(appId));
    if (selectedAppIds.length === 0) {
      vscode.window.showWarningMessage('Select at least one local eCode app in the Local view.');
      return false;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Publish ${selectedAppIds.length} local eCode app(s) to the active environment?`,
      { modal: true },
      'Publish'
    );
    if (confirmation !== 'Publish') return false;

    await this.cancelPublishAppsSelection();

    this._publishing = true;
    try {
      const client = this._getClient();
      const publishedAppCount = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Publishing local eCode apps',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Building app packages...' });
          const outputDirectory = this._prepareAppUpgradeOutputDirectory(projectRoot);
          const packageResult = await buildAppUpgradePackage({
            projectRoot,
            apps: selectedAppIds,
            appConfigs,
            outputDirectory,
          });

          progress.report({ message: `Uploading and importing ${packageResult.plan.apps.length} app(s)...` });
          const publishResult = await publishAppUpgradePackage(
            client,
            packageResult.archivePath,
            packageResult.plan.apps
          );
          return publishResult.appIds.length;
        }
      );
      vscode.window.showInformationMessage(`Published ${publishedAppCount} local eCode app(s).`);
      return true;
    } finally {
      this._publishing = false;
    }
  }

  async renameItem(element: EcodeNode): Promise<void> {
    const extension = this._getNodeFileExtension(element);
    const kind = this._getNodeKindLabel(element);
    const name = await this._promptForName({
      title: `Rename Local ${kind}`,
      kind,
      extension,
      value: element.label,
    });
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
    await this._writeTree(tree);
    await this.refresh();
  }

  async deleteItem(element: EcodeNode): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Delete local ${this._getNodeKindLabel(element)} "${element.label}"? It will be moved to the Recycle Bin.`,
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
    await this._writeTree(tree);
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

  private async _ensureLoaded(): Promise<void> {
    if (this._loaded) return;
    const items = (await readLocalTreeFile(this._getTreePath())) || [];
    this._roots = this._mapTreeItems(items);
    this._loaded = true;
    if (this._publishSelectionActive) this._rebuildPublishSelectionIndex();
  }

  private _getPublishAppIds(element: EcodeNode): string[] {
    if (!this._publishSelectionActive || element.type !== 'folder') return [];
    return this._publishAppIdsByNode.get(element) || [];
  }

  private _rebuildPublishSelectionIndex(): void {
    this._publishSelectionAppIds.clear();
    this._publishAppIdsByNode.clear();

    const indexNode = (element: EcodeNode): string[] => {
      const appIds = new Set<string>();
      if (element.appId) appIds.add(element.appId);
      for (const child of element.children || []) {
        for (const appId of indexNode(child)) appIds.add(appId);
      }
      const indexedAppIds = Array.from(appIds);
      this._publishAppIdsByNode.set(element, indexedAppIds);
      for (const appId of indexedAppIds) this._publishSelectionAppIds.add(appId);
      return indexedAppIds;
    };

    for (const root of this._roots) indexNode(root);
    for (const appId of this._selectedPublishAppIds) {
      if (!this._publishSelectionAppIds.has(appId)) this._selectedPublishAppIds.delete(appId);
    }
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
      if (this._canCreateCodeFile(element)) values.push('localCanCreateFile');
    } else if (element.type === 'file') {
      values.push('localFile');
      if (element.id && !isLocalNodeId(element.id)) {
        values.push('localCanCompareRemote');
      }
      if (this._findContainingAppNode(element)) {
        values.push(element.state === 'pre-state' ? 'localCanCancelPreload' : 'localCanSetPreload');
      }
    }
    if (element.deletable) values.push('localCanRename', 'localCanDelete');
    return values.join(' ');
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
    await this._writeTree(tree);
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
    await this._writeTree(tree);
  }

  private async _createFolderAndNode(parent: EcodeNode, item: EcodeLocalTreeItem, targetPath: string): Promise<void> {
    const target = this._getLocalPath(targetPath);
    if (fs.existsSync(target)) throw new Error(`"${item.name}" already exists.`);
    fs.mkdirSync(target, { recursive: false });
    try {
      this._materializeNewTreeChildren(target, item.children || []);
    } catch (error) {
      fs.rmSync(target, { recursive: true, force: true });
      throw error;
    }
    await this._appendChild(parent.id, item);
  }

  private _materializeNewTreeChildren(parentPath: string, children: EcodeLocalTreeItem[]): void {
    for (const child of children) {
      if (!child.name) throw new Error('A local eCode tree node name is missing.');
      const childPath = path.join(parentPath, child.name);
      if (child.treeType === 'folder') {
        fs.mkdirSync(childPath, { recursive: false });
        this._materializeNewTreeChildren(childPath, child.children || []);
      } else {
        fs.writeFileSync(childPath, '', { encoding: 'utf8', flag: 'wx' });
      }
    }
  }

  private async _appendChild(parentId: string | undefined, child: EcodeLocalTreeItem): Promise<void> {
    if (!parentId) throw new Error('The parent node id is missing.');
    const tree = await this._readTreeRequired();
    const parent = this._findItem(tree, parentId);
    if (!parent) throw new Error('The parent node no longer exists.');
    parent.children = [...(parent.children || []), child];
    parent.hasChild = true;
    await this._writeTree(tree);
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

  private async _materializeFolders(nodes: EcodeNode[]): Promise<void> {
    const visit = async (items: EcodeNode[]): Promise<void> => {
      for (const item of items) {
        if (item.type === 'folder') {
          fs.mkdirSync(this._getLocalPath(item.remotePath), { recursive: true });
        }
        await visit(item.children || []);
      }
    };
    await visit(nodes);
  }

  private async _readTreeRequired(): Promise<EcodeLocalTreeItem[]> {
    const tree = await readLocalTreeFile(this._getTreePath());
    if (!tree) throw new Error('Run Download in the Local view to generate ecode-tree.json first.');
    return tree;
  }

  private async _writeTree(tree: EcodeLocalTreeItem[]): Promise<void> {
    const treePath = this._getTreePath();
    await writeLocalTreeFile(treePath, tree);
    await synchronizeEcodeAppConfigs(treePath);
  }

  private _prepareAppUpgradeOutputDirectory(projectRoot: string): string {
    const outputDirectory = path.join(projectRoot, 'dist', 'app-upgrade');
    fs.mkdirSync(outputDirectory, { recursive: true });
    for (const name of fs.readdirSync(outputDirectory)) {
      fs.rmSync(path.join(outputDirectory, name), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
    return outputDirectory;
  }

  private _getEnvironmentRoot(): string {
    return getActiveEcodeEnvironmentRoot(vscode.workspace.getConfiguration('ecode'));
  }

  private _getClient() {
    return this._clientProvider.get();
  }

  private _getSourceRoot(): string {
    return path.join(this._getEnvironmentRoot(), 'src');
  }

  private _getTreePath(): string {
    return path.join(this._getEnvironmentRoot(), '.ecode', 'ecode-tree.json');
  }

  private _isSamePath(left: string, right: string): boolean {
    const resolvedLeft = path.resolve(left);
    const resolvedRight = path.resolve(right);
    return process.platform === 'win32'
      ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
      : resolvedLeft === resolvedRight;
  }

  private _getLocalPath(relativePath: string): string {
    return resolveTreePath(this._getSourceRoot(), relativePath, 'local eCode path');
  }
}
