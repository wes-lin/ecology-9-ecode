import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { RemoteTreeItem } from './type';
import { isTreeContainer, normalizeTreePath } from './tree-utils';

export type EcodeTreeItem = Omit<RemoteTreeItem, 'children'> & {
  children?: EcodeTreeItem[];
};

export type EcodeDownloadPlan = {
  /**
   * Remote paths to materialize. Omit this field to download every remote file.
   */
  filePaths?: Iterable<string>;
};

export type EcodeDownloadProgress = {
  phase: 'tree' | 'files';
  completed: number;
  total: number;
  relativePath?: string;
};

export type EcodeDownloadOptions = {
  /**
   * Source directory relative to outputRoot. Defaults to `src`.
   */
  sourceDirectory?: string;
  /**
   * Remote tree baseline path. Defaults to `.ecode/ecode-tree.json`.
   */
  treeFilePath?: string;
  overwrite?: boolean;
  /**
   * Called after the complete remote tree is loaded and before the new
   * ecode-tree.json baseline is written.
   */
  prepareTree?: (tree: EcodeTreeItem[]) => EcodeDownloadPlan | void | Promise<EcodeDownloadPlan | void>;
  onProgress?: (progress: EcodeDownloadProgress) => void;
};

export type EcodeDownloadFailure = {
  relativePath: string;
  message: string;
};

export type EcodeDownloadResult = {
  tree: EcodeTreeItem[];
  sourcePath: string;
  treeFilePath: string;
  totalFiles: number;
  downloaded: number;
  skipped: number;
  failed: number;
  failures: EcodeDownloadFailure[];
};

export type EcodeDownloadClient = {
  listTree(folderId?: string, typeId?: string): Promise<RemoteTreeItem[]>;
  viewFile(id: string): Promise<string>;
  viewResource(route: string): Promise<Buffer>;
};

type RemoteFile = {
  item: EcodeTreeItem;
  relativePath: string;
};

function requireNodeValue(item: RemoteTreeItem, field: 'id' | 'name' | 'route'): string {
  const value = item[field];
  if (typeof value !== 'string' || !value) {
    throw new Error(`Remote eCode node "${item.name || item.id || '(unknown)'}" is missing ${field}.`);
  }
  return value;
}

async function loadCompleteTree(
  client: EcodeDownloadClient,
  folderId = '',
  typeId = '',
  ancestors: ReadonlySet<string> = new Set()
): Promise<EcodeTreeItem[]> {
  const items = await client.listTree(folderId, typeId);
  const result: EcodeTreeItem[] = [];

  for (const rawItem of items) {
    const item: EcodeTreeItem = { ...rawItem };
    requireNodeValue(item, 'name');

    if (isTreeContainer(item)) {
      const id = requireNodeValue(item, 'id');
      const key = `${item.treeType || item.businessType || 'node'}:${id}`;
      if (ancestors.has(key)) {
        throw new Error(`Remote eCode tree contains a parent cycle at "${item.name}".`);
      }

      const nextAncestors = new Set(ancestors);
      nextAncestors.add(key);
      const children =
        item.treeType === 'folder'
          ? await loadCompleteTree(client, id, '', nextAncestors)
          : await loadCompleteTree(client, '', id, nextAncestors);
      item.hasChild = children.length > 0;
      if (children.length > 0) item.children = children;
    }
    result.push(item);
  }

  return result;
}

function collectRemoteFiles(items: EcodeTreeItem[]): RemoteFile[] {
  const files: RemoteFile[] = [];

  const visit = (nodes: EcodeTreeItem[], parentPath: string): void => {
    for (const item of nodes) {
      const name = requireNodeValue(item, 'name');
      const relativePath = normalizeTreePath(parentPath ? `${parentPath}/${name}` : name);
      if (isTreeContainer(item)) {
        visit(item.children || [], relativePath);
      } else {
        files.push({ item, relativePath });
      }
    }
  };

  visit(items, '');
  return files;
}

function getSafeTargetPath(sourcePath: string, relativePath: string): string {
  const root = path.resolve(sourcePath);
  const target = path.resolve(root, relativePath.replace(/\//g, path.sep));
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Invalid remote eCode path: ${relativePath}`);
  }
  return target;
}

async function readRemoteFile(client: EcodeDownloadClient, file: RemoteFile): Promise<string | Buffer> {
  if (file.item.treeType === 'resource') {
    return client.viewResource(requireNodeValue(file.item, 'route'));
  }
  return client.viewFile(requireNodeValue(file.item, 'id'));
}

export async function downloadEcode(
  client: EcodeDownloadClient,
  outputRoot: string,
  options: EcodeDownloadOptions = {}
): Promise<EcodeDownloadResult> {
  if (!outputRoot.trim()) throw new Error('eCode download output root is required.');

  const resolvedRoot = path.resolve(outputRoot);
  const sourcePath = path.resolve(resolvedRoot, options.sourceDirectory || 'src');
  const treeFilePath = options.treeFilePath
    ? path.resolve(options.treeFilePath)
    : path.join(resolvedRoot, '.ecode', 'ecode-tree.json');

  options.onProgress?.({ phase: 'tree', completed: 0, total: 0 });
  const tree = await loadCompleteTree(client);
  const allFiles = collectRemoteFiles(tree);
  const plan = await options.prepareTree?.(tree);
  const selectedPaths = plan?.filePaths
    ? new Set(Array.from(plan.filePaths, (filePath) => normalizeTreePath(filePath)))
    : undefined;
  const files = selectedPaths ? allFiles.filter((file) => selectedPaths.has(file.relativePath)) : allFiles;

  await fs.mkdir(path.dirname(treeFilePath), { recursive: true });
  await fs.writeFile(treeFilePath, `${JSON.stringify(tree, null, 2)}\n`, 'utf8');

  let downloaded = 0;
  let skipped = 0;
  const failures: EcodeDownloadFailure[] = [];
  options.onProgress?.({ phase: 'files', completed: 0, total: files.length });

  for (const [index, file] of files.entries()) {
    try {
      const targetPath = getSafeTargetPath(sourcePath, file.relativePath);
      try {
        await fs.access(targetPath);
        if (!options.overwrite) {
          skipped += 1;
          continue;
        }
      } catch {
        // The file does not exist yet.
      }

      const content = await readRemoteFile(client, file);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(
        targetPath,
        Buffer.isBuffer(content) ? content : content.replace(/\r\n?/g, '\n'),
        Buffer.isBuffer(content) ? undefined : 'utf8'
      );
      downloaded += 1;
    } catch (error) {
      failures.push({
        relativePath: file.relativePath,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      options.onProgress?.({
        phase: 'files',
        completed: index + 1,
        total: files.length,
        relativePath: file.relativePath,
      });
    }
  }

  return {
    tree,
    sourcePath,
    treeFilePath,
    totalFiles: files.length,
    downloaded,
    skipped,
    failed: failures.length,
    failures,
  };
}
