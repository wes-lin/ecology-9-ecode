const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { EcodeClient, EcodeLogger } = require('ecode-sdk');
const { EcodeFileSystemProvider } = require('./fileSystemProvider');

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

class EcodeNode {
  constructor({ id, label, type, treeType = '', remotePath = '', hasChild = false, appId = '', attribute = '', deletable = false, state = '' }) {
    this.id = id;
    this.label = label;
    this.type = type; // 'folder' | 'file'
    this.treeType = treeType;
    this.remotePath = remotePath;
    this.hasChild = hasChild;
    this.appId = appId;
    this.attribute = attribute;
    this.deletable = deletable;
    this.state = state;
  }
}

class EcodeTreeDataProvider {
  constructor(cookieFile) {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.cookieFile = cookieFile;
    this.client = null;
    this.rootItems = [];
    this._busy = false;

    // 文件内容缓存：uri → 内容字符串
    this._fileContents = new Map();

    // 注册只读 FileSystemProvider（提供面包屑等原生功能）
    this._fileSystemProvider = new EcodeFileSystemProvider(this);
    this._fsRegistration = vscode.workspace.registerFileSystemProvider('ecode', this._fileSystemProvider, {
      isCaseSensitive: false,
      isReadonly: true,
    });
  }

  async refresh() {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    this.client = null;
    this.rootItems = [];
    this._fileContents.clear();
    this._onDidChangeTreeData.fire();
  }

  refreshFolder(element) {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    if (!element) {
      this.refresh();
      return;
    }
    delete element.children;
    this._onDidChangeTreeData.fire(element);
  }

  dispose() {
    this._fsRegistration.dispose();
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element) {
    const isInfo = element.type === 'info';
    const isFile = element.type === 'file' || !element.hasChild;
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

  async getChildren(element) {
    if (this._busy) {
      if (element?.children) {
        return element.children;
      }
      if (!element && this.rootItems.length > 0) {
        return this.rootItems;
      }
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
      } catch (err) {
        return [new EcodeNode({ label: `❌ ${err.message}`, type: 'info' })];
      }
    } else if (element.hasChild) {
      let tree;
      if (element.treeType === 'folder') {
        tree = await client.listTree(element.id, '');
      } else {
        tree = await client.listTree('', element.id);
      }
      const children = this._mapTree(tree, element.remotePath);
      element.children = children;
      return children;
    }

    return [];
  }

  async download() {
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
          const nodes = { folders: [], files: [] };
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
    } catch (err) {
      vscode.window.showErrorMessage(`Download failed: ${err.message}`);
    } finally {
      await this._setBusy(false);
    }
  }

  async viewFile(element) {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    try {
      const client = this._getClient();
      const buffer = await client.viewFile(element.id);

      const uri = vscode.Uri.parse(`ecode:/${element.remotePath}`);
      this._fileContents.set(uri.toString(), buffer.toString('utf-8'));

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      vscode.window.showErrorMessage(`View file failed: ${err.message}`);
    }
  }

  async openLocalFile(element) {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    try {
      const targetPath = await this._ensureLocalFileFromRemote(element, { overwrite: false });
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      vscode.window.showErrorMessage(`Open local file failed: ${err.message}`);
    }
  }

  async compareWithRemote(element) {
    if (this._busy) {
      vscode.window.showWarningMessage('eCode Explorer is busy downloading.');
      return;
    }

    try {
      const targetPath = await this._ensureLocalFileFromRemote(element, { overwrite: false });
      const client = this._getClient();
      const remoteContent = await client.viewFile(element.id);
      const remoteUri = vscode.Uri.from({
        scheme: 'ecode',
        path: `/${this._getSafeRelativeRemotePath(element.remotePath).replace(/\\/g, '/')}`,
        query: `compare=${Date.now()}`,
      });
      const localUri = vscode.Uri.file(targetPath);

      this._fileContents.set(remoteUri.toString(), remoteContent.toString('utf-8'));
      await vscode.commands.executeCommand('vscode.diff', remoteUri, localUri, `${element.label}: Remote ↔ Local`);
    } catch (err) {
      vscode.window.showErrorMessage(`Compare failed: ${err.message}`);
    }
  }

  async deleteItem(element) {
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

  async _setBusy(value) {
    this._busy = value;
    await vscode.commands.executeCommand('setContext', 'ecodeExplorer.busy', value);
    this._onDidChangeTreeData.fire();
  }

  async _listRemoteChildren(element) {
    const client = this._getClient();
    if (!element) {
      const tree = await client.listTree();
      return this._mapTree(tree, '');
    }

    const tree =
      element.treeType === 'folder' ? await client.listTree(element.id, '') : await client.listTree('', element.id);
    return this._mapTree(tree, element.remotePath);
  }

  async _collectDownloadNodes(element, nodes) {
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

  async _ensureLocalFolderFromRemote(element) {
    const targetPath = this._getLocalPath(element);
    await mkdir(targetPath, { recursive: true });
    return targetPath;
  }

  async _ensureLocalFileFromRemote(element, { overwrite = false } = {}) {
    const targetPath = this._getLocalPath(element);
    if (!overwrite && fs.existsSync(targetPath)) {
      return targetPath;
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    const client = this._getClient();
    const content = await client.viewFile(element.id);
    await writeFile(targetPath, content.toString('utf-8'));
    return targetPath;
  }

  _getWorkspaceFolderPath() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      throw new Error('No workspace folder open.');
    }
    return workspaceFolder;
  }

  _getLocalRootPath() {
    const config = this._getConfig();
    const localDir = config.get('localDir', 'src');
    return path.resolve(this._getWorkspaceFolderPath(), localDir);
  }

  _getSafeRelativeRemotePath(remotePath) {
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

  _getLocalPath(element) {
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

  _getConfig() {
    return vscode.workspace.getConfiguration('ecode');
  }

  _getClient() {
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

  _mapTree(tree, parentPath = '') {
    if (!Array.isArray(tree)) return [];
    return tree.map((item) => {
      const remotePath = parentPath ? `${parentPath.replace(/\/$/, '')}/${item.name}` : item.name;
      return new EcodeNode({
        id: item.id,
        label: item.name,
        type: item.treeType === 'folder' || item.businessType === 'type' || item.businessType === 'project' ? 'folder' : 'file',
        treeType: item.treeType || '',
        remotePath,
        hasChild: item.hasChild || false,
        appId: item.initialAppId || '',
        attribute: item.attribute || '',
        deletable: !['system', 'jar', 'config', 'resource', 'non-code'].includes(item.attribute),
        state: item.state || '',
      });
    });
  }
}

module.exports = { EcodeTreeDataProvider, EcodeNode };
