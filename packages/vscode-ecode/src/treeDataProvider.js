const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { EcodeClient } = require('ecode-sdk');

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

class EcodeNode {
  constructor(id, label, type, treeType, remotePath, hasChild, children = [], appId) {
    this.id = id;
    this.label = label;
    this.type = type; // 'folder' | 'file'
    this.treeType = treeType;
    this.remotePath = remotePath;
    this.hasChild = hasChild;
    this.children = children;
    this.appId = appId;
  }
}

class EcodeTreeDataProvider {
  constructor(cookieFile) {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.cookieFile = cookieFile;
    this.client = null;
    this.rootItems = [];
  }

  refresh() {
    this.client = null;
    this.rootItems = [];
    this._onDidChangeTreeData.fire();
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
      treeItem.contextValue = element.type;
      treeItem.tooltip = element.remotePath;
      treeItem.command =
        element.type === 'file'
          ? { command: 'ecode.downloadFile', title: 'Download', arguments: [element] }
          : undefined;
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
    if (!client.isLoggedIn()) {
      await client.login();
    }
    if (!element) {
      try {
        const tree = await client.listTree();
        this.rootItems = this._mapTree(tree);
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
      return this._mapTree(tree);
    }

    return [];
  }

  async downloadFile(element) {
    try {
      const config = this._getConfig();
      const localDir = config.get('localDir', 'src');
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      const targetDir = path.join(workspaceFolder, localDir, path.dirname(element.remotePath));
      await mkdir(targetDir, { recursive: true });

      const client = this._getClient();
      if (!client.isLoggedIn()) {
        await client.login();
      }
      const buffer = await client.downloadFile(element.remotePath);

      const targetPath = path.join(workspaceFolder, localDir, element.remotePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, buffer);

      vscode.window.showInformationMessage(`Downloaded ${element.remotePath}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Download failed: ${err.message}`);
    }
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
      });
    }
    return this.client;
  }

  _mapTree(tree) {
    if (!Array.isArray(tree)) return [];
    return tree.map((item) => {
      return new EcodeNode(
        item.id,
        item.name || 'unknown',
        item.treeType === 'folder' || item.businessType === 'type' || item.businessType === 'project'
          ? 'folder'
          : 'file',
        item.treeType || '',
        item.path || item.remotePath || item.name || '',
        item.hasChild
      );
    });
  }
}

module.exports = { EcodeTreeDataProvider, EcodeNode };
