import * as vscode from 'vscode';
import type { EcodeNode } from './ecodeNode';
import type { EcodeTreeDataProvider } from './treeDataProvider';

/**
 * EcodeFileSystemProvider
 *
 * 将远程文件映射为 VSCode 虚拟文件系统（scheme: ecode），使面包屑、
 * 资源管理器等原生功能可用。只读：readFile / stat / readDirectory，
 * 不支持写入。
 */
export class EcodeFileSystemProvider implements vscode.FileSystemProvider {
  private tree: EcodeTreeDataProvider;
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  /**
   * @param treeDataProvider EcodeTreeDataProvider 实例，提供 rootItems 和 _fileContents
   */
  constructor(treeDataProvider: EcodeTreeDataProvider) {
    this.tree = treeDataProvider;
  }

  /**
   * 根据路径判断文件/文件夹类型
   * @param uri 如 ecode:/foo/bar.js
   * @returns 文件状态
   */
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const filePath = uri.path;

    // 文件内容缓存中有记录 → 文件
    if (this.tree._fileContents.has(uri.toString())) {
      return { type: vscode.FileType.File, ctime: Date.now(), mtime: Date.now(), size: -1 };
    }

    // 尝试从已加载的树节点判断是否为文件夹
    const isDir = this._isKnownDirectory(filePath);
    if (isDir) {
      return { type: vscode.FileType.Directory, ctime: Date.now(), mtime: Date.now(), size: -1 };
    }

    // 兜底：未知路径当作文件（打开时会触发 viewFile 加载）
    return { type: vscode.FileType.File, ctime: Date.now(), mtime: Date.now(), size: -1 };
  }

  /**
   * 读取文件内容
   * @param uri
   * @returns 文件内容字节
   */
  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const content = this.tree._fileContents.get(uri.toString());
    if (content !== undefined) {
      return Buffer.from(content, 'utf8');
    }
    // 未缓存时返回空，避免报错
    return Buffer.from('', 'utf8');
  }

  /**
   * 列出目录下的直接子项
   * @param uri
   * @returns 子项名称和文件类型
   */
  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const dirPath = uri.path;
    const entries: [string, vscode.FileType][] = [];
    this._collectChildren(dirPath, entries);
    return entries;
  }

  // ── 只读 FS：以下方法不支持 ────────────────────────────────────────────────

  watch(): vscode.Disposable {
    return { dispose() {} };
  }

  async writeFile(): Promise<void> {
    throw new Error('Read-only filesystem');
  }

  async delete(): Promise<void> {
    throw new Error('Read-only filesystem');
  }

  async rename(): Promise<void> {
    throw new Error('Read-only filesystem');
  }

  async createDirectory(): Promise<void> {
    throw new Error('Read-only filesystem');
  }

  // ── 内部工具 ───────────────────────────────────────────────────────────────

  get rootItems(): EcodeNode[] {
    return this.tree.rootItems;
  }

  /** 从树节点中收集指定路径下的直接子项 */
  _collectChildren(dirPath: string, result: [string, vscode.FileType][]): void {
    const nodesToScan = this.rootItems || [];

    if (dirPath && dirPath !== '/') {
      const targetNode = this._findNodeByPath(dirPath, nodesToScan);
      if (!targetNode?.children) return;
      for (const child of targetNode.children) {
        result.push([child.label, child.type === 'folder' ? vscode.FileType.Directory : vscode.FileType.File]);
      }
      return;
    }

    for (const node of nodesToScan) {
      result.push([node.label, node.type === 'folder' ? vscode.FileType.Directory : vscode.FileType.File]);
    }
  }

  /** 递归查找路径对应的树节点 */
  _findNodeByPath(targetPath: string, nodes: EcodeNode[]): EcodeNode | null {
    const normalized = targetPath.replace(/^\//, '');
    for (const node of nodes) {
      if ((node.remotePath || '') === normalized) return node;
      if (node.children) {
        const found = this._findNodeByPath(targetPath, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  /** 判断路径是否为已知的文件夹节点 */
  _isKnownDirectory(filePath: string): boolean {
    const normalized = filePath.replace(/^\//, '');
    const check = (nodes: EcodeNode[]): boolean => {
      for (const node of nodes) {
        if ((node.remotePath || '') === normalized && node.type === 'folder') return true;
        if (node.children?.length && check(node.children)) return true;
      }
      return false;
    };
    return check(this.rootItems || []);
  }
}
