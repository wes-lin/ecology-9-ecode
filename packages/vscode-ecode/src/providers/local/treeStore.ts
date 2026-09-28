import * as fs from 'node:fs';
import * as path from 'node:path';
import { synchronizeEcodeAppConfigs } from 'ecode-sdk';
import { readLocalTreeFile, writeLocalTreeFile, type EcodeLocalTreeItem } from '../../config/ecodeLocalTree';
import { EcodeSettingsRepository } from '../../config/ecodeSettingsRepository';
import { resolveTreePath } from '../../utils/pathUtils';
import type { EcodeNode } from '../ecodeNode';
import {
  associateLocalItems,
  findUnassociatedLocalItems,
  type LocalAssociationResult,
  type LocalDirectoryKind,
  type UnassociatedLocalItem,
} from './associateLocalItems';

export class LocalEcodeTreeStore {
  constructor(private readonly settings: EcodeSettingsRepository) {}

  get environmentRoot(): string {
    return this.settings.activeEnvironmentRoot;
  }

  get sourceRoot(): string {
    return path.join(this.environmentRoot, 'src');
  }

  get treePath(): string {
    return path.join(this.environmentRoot, '.ecode', 'ecode-tree.json');
  }

  get treeExists(): boolean {
    return fs.existsSync(this.treePath);
  }

  localPath(relativePath: string): string {
    return resolveTreePath(this.sourceRoot, relativePath, 'local eCode path');
  }

  isTreePath(candidate: string): boolean {
    const left = path.resolve(this.treePath);
    const right = path.resolve(candidate);
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
  }

  read(): Promise<EcodeLocalTreeItem[] | undefined> {
    return readLocalTreeFile(this.treePath);
  }

  async readRequired(): Promise<EcodeLocalTreeItem[]> {
    const tree = await this.read();
    if (!tree) throw new Error('Run Download in the Local view to generate ecode-tree.json first.');
    return tree;
  }

  async write(tree: EcodeLocalTreeItem[]): Promise<void> {
    await writeLocalTreeFile(this.treePath, tree);
    await this.synchronize();
  }

  synchronize(): Promise<unknown> {
    return synchronizeEcodeAppConfigs(this.treePath);
  }

  async findUnassociatedLocalItems(tree: EcodeLocalTreeItem[]): Promise<UnassociatedLocalItem[]> {
    if (!fs.existsSync(this.sourceRoot)) return [];
    return findUnassociatedLocalItems(this.sourceRoot, tree);
  }

  isSourcePath(candidate: string): boolean {
    try {
      const relative = path.relative(this.sourceRoot, candidate);
      return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    } catch {
      return false;
    }
  }

  async associateLocalItem(relativePath: string, kind?: LocalDirectoryKind): Promise<LocalAssociationResult> {
    const tree = await this.readRequired();
    if (!fs.existsSync(this.sourceRoot)) throw new Error(`Local eCode source directory not found: ${this.sourceRoot}`);
    this.localPath(relativePath);
    const result = await associateLocalItems(this.sourceRoot, tree, async () => kind, relativePath);
    if (result.apps + result.types + result.folders + result.files > 0) await this.write(tree);
    return result;
  }

  async appendChild(parentId: string | undefined, child: EcodeLocalTreeItem): Promise<void> {
    if (!parentId) throw new Error('The parent node id is missing.');
    const tree = await this.readRequired();
    const parent = this.findItem(tree, parentId);
    if (!parent) throw new Error('The parent node no longer exists.');
    parent.children = [...(parent.children || []), child];
    parent.hasChild = true;
    await this.write(tree);
  }

  findItem(items: EcodeLocalTreeItem[], id: string | undefined): EcodeLocalTreeItem | undefined {
    if (!id) return undefined;
    for (const item of items) {
      if (item.id === id) return item;
      const child = this.findItem(item.children || [], id);
      if (child) return child;
    }
    return undefined;
  }

  removeItem(items: EcodeLocalTreeItem[], id: string | undefined): boolean {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) {
      items.splice(index, 1);
      return true;
    }
    return items.some((item) => this.removeItem(item.children || [], id));
  }

  async resetAssociation(id: string | undefined, relativePath: string): Promise<void> {
    const tree = await this.readRequired();
    this.removeAssociationNode(tree, id, relativePath);
    await this.write(tree);
  }

  private removeAssociationNode(tree: EcodeLocalTreeItem[], id: string | undefined, relativePath: string): void {
    const item = this.findItem(tree, id);
    if (!item?.localOnly || (item.businessType !== 'type' && !item.initialAppId)) {
      throw new Error('Only locally created or associated types and apps can be reset.');
    }
    const target = this.localPath(relativePath);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      throw new Error('The selected local folder no longer exists.');
    }
    this.removeItem(tree, id);
  }

  async createFolderAndNode(
    parentId: string | undefined,
    item: EcodeLocalTreeItem,
    relativePath: string
  ): Promise<void> {
    const target = this.localPath(relativePath);
    if (fs.existsSync(target)) throw new Error(`"${item.name}" already exists.`);
    fs.mkdirSync(target, { recursive: false });
    try {
      this.materializeNewTreeChildren(target, item.children || []);
      await this.appendChild(parentId, item);
    } catch (error) {
      fs.rmSync(target, { recursive: true, force: true });
      throw error;
    }
  }

  async createRootFolderAndNode(item: EcodeLocalTreeItem, relativePath: string): Promise<void> {
    const tree = await this.readRequired();
    const target = this.localPath(relativePath);
    if (fs.existsSync(target)) throw new Error(`"${item.name}" already exists.`);
    fs.mkdirSync(this.sourceRoot, { recursive: true });
    fs.mkdirSync(target, { recursive: false });
    try {
      this.materializeNewTreeChildren(target, item.children || []);
      await this.write([...tree, item]);
    } catch (error) {
      fs.rmSync(target, { recursive: true, force: true });
      throw error;
    }
  }

  materializeFolders(nodes: EcodeNode[]): void {
    for (const item of nodes) {
      if (item.type === 'folder') fs.mkdirSync(this.localPath(item.remotePath), { recursive: true });
      this.materializeFolders(item.children || []);
    }
  }

  prepareAppUpgradeOutputDirectory(): string {
    const outputDirectory = path.join(this.environmentRoot, 'dist', 'app-upgrade');
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

  private materializeNewTreeChildren(parentPath: string, children: EcodeLocalTreeItem[]): void {
    for (const child of children) {
      if (!child.name) throw new Error('A local eCode tree node name is missing.');
      const childPath = path.join(parentPath, child.name);
      if (child.treeType === 'folder') {
        fs.mkdirSync(childPath, { recursive: false });
        this.materializeNewTreeChildren(childPath, child.children || []);
      } else {
        fs.writeFileSync(childPath, '', { encoding: 'utf8', flag: 'wx' });
      }
    }
  }
}
