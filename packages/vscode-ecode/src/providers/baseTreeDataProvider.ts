import * as vscode from 'vscode';
import { getEcodeAppId, type EcodeTreeItem } from 'ecode-sdk';
import { normalizeTreePath } from '../utils/pathUtils';
import { EcodeNode } from './ecodeNode';

export type EcodeTreeItemPresentation = {
  resourceUri?: vscode.Uri;
  tooltip?: string;
  contextValue?: string;
  fileCommand?: vscode.Command;
};

export type EcodeNodeNamePromptOptions = {
  title: string;
  kind: string;
  value?: string;
  extension?: string;
};

export abstract class BaseEcodeTreeDataProvider implements vscode.TreeDataProvider<EcodeNode>, vscode.Disposable {
  protected readonly _onDidChangeTreeData = new vscode.EventEmitter<EcodeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  abstract getChildren(element?: EcodeNode): vscode.ProviderResult<EcodeNode[]>;

  protected abstract _getTreeItemPresentation(element: EcodeNode): EcodeTreeItemPresentation;

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: EcodeNode): vscode.TreeItem {
    const isInfo = element.type === 'info';
    const isFile = element.type === 'file';
    const item = new vscode.TreeItem(
      element.label,
      isInfo || isFile ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed
    );
    if (isInfo) return item;

    const presentation = this._getTreeItemPresentation(element);
    item.iconPath = this._getNodeIcon(element);
    item.resourceUri = presentation.resourceUri;
    item.tooltip = presentation.tooltip;
    item.contextValue = presentation.contextValue;
    if (element.state === 'pre-state') item.description = 'P';
    if (isFile && presentation.fileCommand) item.command = presentation.fileCommand;
    return item;
  }

  protected _getNodeIcon(element: EcodeNode): vscode.ThemeIcon {
    if (element.loading) return new vscode.ThemeIcon('sync~spin');
    if (element.type === 'file') return new vscode.ThemeIcon('file');
    if (element.debugMode === 'y') return new vscode.ThemeIcon('debug');
    if (element.businessType === 'project') return new vscode.ThemeIcon('project');
    if (element.businessType === 'type') return new vscode.ThemeIcon('symbol-folder');
    if (element.appId) {
      return new vscode.ThemeIcon(element.appStatus === 'released' ? 'vm-active' : 'vm-outline');
    }
    return new vscode.ThemeIcon('folder');
  }

  protected _mapTreeItems(items: EcodeTreeItem[], parentPath = '', parent?: EcodeNode): EcodeNode[] {
    return items.map((item) => this._mapTreeItem(item, parentPath, parent));
  }

  protected _mapTreeItem(item: EcodeTreeItem, parentPath = '', parent?: EcodeNode): EcodeNode {
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
      appId: getEcodeAppId(item),
      attribute: item.attribute || '',
      deletable: !['system', 'jar', 'config', 'resource', 'non-code'].includes(item.attribute || ''),
      state: item.state || '',
      appStatus: item.attribute === 'system' ? 'released' : item.status || '',
      appPreStateOrder: item.preStateOrder || 10000,
      fileExtension: item.fileExtension || '',
      debugMode: item.debugMode,
    });
    if (item.children) {
      node.children = this._mapTreeItems(item.children, remotePath, node);
    }
    return node;
  }

  protected _requireType(element: EcodeNode, expected: 'folder' | 'file'): void {
    if (element.type !== expected) throw new Error(`Select a ${expected}.`);
  }

  protected _getNodeKindLabel(element: EcodeNode): string {
    if (element.businessType === 'type') return 'type';
    if (element.type === 'file') return 'file';
    if (element.appId) return 'app';
    return 'folder';
  }

  protected _getNodeFileExtension(element: EcodeNode): string | undefined {
    if (element.type !== 'file') return undefined;
    const extension = element.fileExtension?.trim().replace(/^\./, '');
    return extension || element.label.match(/\.([^.]+)$/)?.[1];
  }

  protected _findContainingAppNode(element: EcodeNode): EcodeNode | undefined {
    let current: EcodeNode | undefined = element.type === 'file' ? element.parent : element;
    while (current) {
      if (current.appId) return current;
      current = current.parent;
    }
    return undefined;
  }

  protected _childPath(parent: EcodeNode, name: string): string {
    return normalizeTreePath(`${parent.remotePath}/${name}`);
  }

  protected async _promptForName(options: EcodeNodeNamePromptOptions): Promise<string | undefined> {
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
        if (normalizedExtension && trimmed.includes('.')) {
          const currentExtension = trimmed.match(/\.([^.]+)$/)?.[1];
          if (currentExtension !== normalizedExtension) {
            return `${options.kind} name must end with .${normalizedExtension}.`;
          }
        }
        return undefined;
      },
    });

    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!normalizedExtension || trimmed.includes('.')) return trimmed;
    return `${trimmed}.${normalizedExtension}`;
  }
}
