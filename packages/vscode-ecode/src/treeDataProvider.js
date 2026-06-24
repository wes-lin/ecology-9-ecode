const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { EcodeClient, EcodeLogger } = require('ecode-sdk');
const { EcodeFileSystemProvider } = require('./fileSystemProvider');

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

class EcodeNode {
  constructor(id, label, type, treeType, remotePath, hasChild, appId, attribute, deletable, state) {
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

    // 文件内容缓存：uri → 内容字符串
    this._fileContents = new Map();

    // 注册只读 FileSystemProvider（提供面包屑等原生功能）
    this._fileSystemProvider = new EcodeFileSystemProvider(this);
    this._fsRegistration = vscode.workspace.registerFileSystemProvider('ecode', this._fileSystemProvider, {
      isCaseSensitive: false,
      isReadonly: true,
    });
  }

  refresh() {
    this.client = null;
    this.rootItems = [];
    this._fileContents.clear();
    this._onDidChangeTreeData.fire();
  }

  refreshFolder(element) {
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
          return [new EcodeNode('(empty)', 'info', '', [])];
        }
        return this.rootItems;
      } catch (err) {
        return [new EcodeNode(`❌ ${err.message}`, 'info', '', [])];
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
    vscode.window.showInformationMessage('Download is not implemented yet.');
  }

  async viewFile(element) {
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
    try {
      const targetPath = await this._ensureLocalFileFromRemote(element, { overwrite: false });
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      vscode.window.showErrorMessage(`Open local file failed: ${err.message}`);
    }
  }

  async compareWithRemote(element) {
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
      return new EcodeNode(
        item.id,
        item.name,
        item.treeType === 'folder' || item.businessType === 'type' || item.businessType === 'project'
          ? 'folder'
          : 'file',
        item.treeType || '',
        remotePath,
        item.hasChild || false,
        item.initialAppId || '',
        item.attribute || '',
        !['system', 'jar', 'config', 'resource', 'non-code'].includes(item.attribute),
        item.state || ''
      );
    });
  }
}

module.exports = { EcodeTreeDataProvider, EcodeNode };
