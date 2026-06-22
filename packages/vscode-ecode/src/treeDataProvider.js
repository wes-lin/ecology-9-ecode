const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { EcodeClient } = require('ecode-sdk');

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

class EcodeNode {
  constructor(id, label, type, treeType, remotePath, hasChild, appId) {
    this.id = id;
    this.label = label;
    this.type = type; // 'folder' | 'file'
    this.treeType = treeType;
    this.remotePath = remotePath;
    this.hasChild = hasChild;
    this.appId = appId;
    this.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
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
      const isDownloadableFolder = element.type === 'folder' && element.appId;
      treeItem.contextValue = isDownloadableFolder ? 'downloadable' : element.type;
      treeItem.tooltip = element.remotePath;
      if (isDownloadableFolder) {
        treeItem.checkboxState = element.checkboxState;
      }
      if (element.type === 'file') {
        treeItem.command = { command: 'ecode.viewFile', title: 'View File', arguments: [element] };
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
      const children = this._mapTree(tree);
      element.children = children;
      return children;
    }

    return [];
  }

  setCheckboxState(element, state) {
    element.checkboxState = state;
  }

  getCheckedItems() {
    const checked = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.type === 'folder' && node.appId && node.checkboxState === vscode.TreeItemCheckboxState.Checked) {
          checked.push(node);
        }
        if (node.children && node.children.length > 0) {
          walk(node.children);
        }
      }
    };
    walk(this.rootItems);
    return checked;
  }

  async downloadSelected() {
    const items = this.getCheckedItems();
    if (items.length === 0) {
      vscode.window.showWarningMessage('No folders selected. Check the checkbox next to folders to download.');
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Download ${items.length} folder(s)?`,
      { modal: true },
      'Download'
    );
    if (confirm !== 'Download') return;

    let success = 0;
    let failed = 0;
    for (const item of items) {
      try {
        await this.downloadFile(item);
        success++;
      } catch {
        failed++;
      }
    }
    vscode.window.showInformationMessage(`Batch download complete: ${success} succeeded, ${failed} failed.`);
  }

  async viewFile(element) {
    try {
      const client = this._getClient();
      const buffer = await client.viewFile(element.id);
      console.log(buffer);

      const uri = vscode.Uri.parse(`ecode:${element.remotePath}`);
      const provider = new (class {
        provideTextDocumentContent() {
          return buffer.toString('utf-8');
        }
      })();
      const registration = vscode.workspace.registerTextDocumentContentProvider('ecode', provider);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true });
      registration.dispose();
    } catch (err) {
      vscode.window.showErrorMessage(`View file failed: ${err.message}`);
    }
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
        item.name,
        item.treeType === 'folder' || item.businessType === 'type' || item.businessType === 'project'
          ? 'folder'
          : 'file',
        item.treeType || '',
        item.name,
        item.hasChild || false,
        item.initialAppId
      );
    });
  }
}

module.exports = { EcodeTreeDataProvider, EcodeNode };
