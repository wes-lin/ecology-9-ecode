import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { EcodeLocalTreeItem } from '../../config/ecodeLocalTree';
import { createEcodeId, createLocalNodeId } from '../../utils/localNodeId';

export type LocalDirectoryKind = 'app' | 'type';
export type LocalAssociationResult = {
  apps: number;
  types: number;
  folders: number;
  files: number;
  skipped: number;
};

export type UnassociatedLocalItem = {
  name: string;
  relativePath: string;
  parentPath: string;
  isDirectory: boolean;
};

function isDirectoryNode(node: EcodeLocalTreeItem): boolean {
  return node.treeType === 'folder' || node.businessType === 'type' || node.businessType === 'project';
}

export async function findUnassociatedLocalItems(
  sourceRoot: string,
  tree: EcodeLocalTreeItem[]
): Promise<UnassociatedLocalItem[]> {
  const found: UnassociatedLocalItem[] = [];
  async function visit(directory: string, nodes: EcodeLocalTreeItem[], parentPath: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      const node = nodes.find((item) => item.name === entry.name);
      if (!node) {
        found.push({ name: entry.name, relativePath, parentPath, isDirectory: entry.isDirectory() });
      } else if (entry.isDirectory() && isDirectoryNode(node)) {
        await visit(path.join(directory, entry.name), node.children || [], relativePath);
      }
    }
  }

  await visit(sourceRoot, tree, '');
  return found.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function associateLocalItems(
  sourceRoot: string,
  tree: EcodeLocalTreeItem[],
  chooseDirectoryKind: (relativePath: string) => Promise<LocalDirectoryKind | undefined>,
  targetPath?: string
): Promise<LocalAssociationResult> {
  const result: LocalAssociationResult = { apps: 0, types: 0, folders: 0, files: 0, skipped: 0 };

  async function visit(directory: string, nodes: EcodeLocalTreeItem[], parent?: EcodeLocalTreeItem, appPath = ''): Promise<void> {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const entryPath = path.join(directory, entry.name);
      const relativePath = path.relative(sourceRoot, entryPath).replace(/\\/g, '/');
      if (targetPath && relativePath !== targetPath && !targetPath.startsWith(`${relativePath}/`) && !relativePath.startsWith(`${targetPath}/`)) continue;
      let node = nodes.find((item) => item.name === entry.name);

      if (node) {
        if (entry.isDirectory() && isDirectoryNode(node)) {
          await visit(
            entryPath,
            node.children ?? (node.children = []),
            node,
            node.initialAppId || node.attribute === 'system' ? relativePath : appPath
          );
        }
        continue;
      }

      if (entry.isDirectory()) {
        let kind: LocalDirectoryKind | undefined;
        if (!parent) kind = 'type';
        else if (parent.businessType === 'type' || parent.businessType === 'project') {
          kind = await chooseDirectoryKind(relativePath);
          if (!kind) {
            result.skipped += 1;
            continue;
          }
        }

        if (kind === 'app') {
          const id = createEcodeId();
          node = { id, name: entry.name, treeType: 'folder', initialAppId: id, status: '', preStateOrder: 10000, localOnly: true, children: [] };
          result.apps += 1;
        } else if (kind === 'type') {
          node = { id: createEcodeId(), name: entry.name, treeType: 'folder', businessType: 'type', localOnly: true, children: [] };
          result.types += 1;
        } else {
          const attribute = parent?.initialAppId
            ? ({ config: 'config', jar: 'jar', resources: 'resource' } as Record<string, string>)[entry.name]
            : undefined;
          node = { id: createLocalNodeId(), name: entry.name, treeType: 'folder', children: [] };
          if (attribute) node.attribute = attribute;
          result.folders += 1;
        }
        nodes.push(node);
        if (targetPath === relativePath && kind === 'type') continue;
        await visit(entryPath, node.children!, node, node.initialAppId ? relativePath : appPath);
        continue;
      }

      const inResource = parent?.attribute === 'resource' || appPath && relativePath.startsWith(`${appPath}/resources/`);
      const inConfig = parent?.attribute === 'config' || appPath && relativePath.startsWith(`${appPath}/config/`);
      node = {
        id: createLocalNodeId(),
        name: entry.name,
        treeType: inResource ? 'resource' : 'file',
        fileExtension: path.extname(entry.name).replace(/^\./, ''),
      };
      if (inConfig) {
        node.attribute = entry.name === 'config.js' || entry.name === 'configLoad.js' ? 'config' : 'non-code';
        if (entry.name === 'config.js' || entry.name === 'config_default.js') node.state = 'pre-state';
      }
      nodes.push(node);
      result.files += 1;
    }
  }

  await visit(sourceRoot, tree);
  return result;
}
