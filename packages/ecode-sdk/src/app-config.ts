import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { EcodeTreeItem } from './downloader';
import { getEcodeAppId, isTreeContainer, normalizeTreePath } from './tree-utils';

export type EcodeAppConfig = {
  path: string;
  appId: string;
  appStatus: string;
  appPreStateOrder: number;
  preStateFiles: string[];
  resources: string[];
  configs: string[];
  debugMode: 'y' | 'n';
};

type IndexedTreeItem = {
  item: EcodeTreeItem;
  path: string;
  appId: string;
  isContainer: boolean;
};

type EcodeAppConfigEntry = {
  nodeId: string;
  config: EcodeAppConfig;
};

function indexTree(items: EcodeTreeItem[]): IndexedTreeItem[] {
  const indexed: IndexedTreeItem[] = [];

  const visit = (nodes: EcodeTreeItem[], parentPath: string): void => {
    for (const item of nodes) {
      const itemPath = normalizeTreePath(parentPath ? `${parentPath}/${item.name || ''}` : item.name || '');
      indexed.push({
        item,
        path: itemPath,
        appId: getEcodeAppId(item),
        isContainer: isTreeContainer(item),
      });
      visit(item.children || [], itemPath);
    }
  };

  visit(items, '');
  return indexed;
}

function relativeDescendantPath(parentPath: string, candidatePath: string): string | undefined {
  const prefix = `${normalizeTreePath(parentPath)}/`;
  return candidatePath.startsWith(prefix) ? candidatePath.slice(prefix.length) : undefined;
}

function getAppConfigFileName(nodeId: string): string {
  if (
    !nodeId ||
    /[<>:"/\\|?*]/.test(nodeId) ||
    Array.from(nodeId).some((character) => character.charCodeAt(0) <= 31) ||
    /[. ]$/.test(nodeId) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(nodeId)
  ) {
    throw new Error(`Invalid eCode node id for an app config file: ${nodeId || '(empty)'}`);
  }
  return `${nodeId}.json`;
}

async function readEcodeTreeFile(treeFilePath: string): Promise<EcodeTreeItem[] | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(treeFilePath, 'utf8'));
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid local eCode tree at ${treeFilePath}: expected a JSON array.`);
    }
    return parsed as EcodeTreeItem[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function collectEcodeAppConfigEntries(items: EcodeTreeItem[]): EcodeAppConfigEntry[] {
  const indexed = indexTree(items);
  const files = indexed.filter((entry) => !entry.isContainer);
  const appIds = new Set<string>();

  return indexed
    .filter((entry) => entry.isContainer && entry.appId)
    .map((app) => {
      if (appIds.has(app.appId)) {
        throw new Error(`Duplicate eCode appId "${app.appId}" in ecode-tree.json.`);
      }
      appIds.add(app.appId);

      const descendants = files
        .map((file) => ({ file, relativePath: relativeDescendantPath(app.path, file.path) }))
        .filter((entry): entry is { file: IndexedTreeItem; relativePath: string } => entry.relativePath !== undefined);
      const collectPaths = (predicate: (item: EcodeTreeItem) => boolean): string[] =>
        descendants.filter(({ file }) => predicate(file.item)).map(({ relativePath }) => relativePath);

      return {
        nodeId: app.item.id || '',
        config: {
          path: app.path,
          appId: app.appId,
          appStatus: app.item.attribute === 'system' ? 'released' : app.item.status || '',
          appPreStateOrder: app.item.preStateOrder ?? 10000,
          preStateFiles: collectPaths((item) => item.state === 'pre-state' || item.attribute === 'system'),
          resources: collectPaths((item) => item.treeType === 'resource'),
          configs: collectPaths((item) => item.attribute === 'config' || item.attribute === 'non-code'),
          debugMode: app.item.debugMode || 'n',
        },
      };
    });
}

export function collectEcodeAppConfigs(items: EcodeTreeItem[]): EcodeAppConfig[] {
  return collectEcodeAppConfigEntries(items).map(({ config }) => config);
}

export async function synchronizeEcodeAppConfigs(treeFilePath: string): Promise<EcodeAppConfig[]> {
  const tree = await readEcodeTreeFile(treeFilePath);
  const entries = collectEcodeAppConfigEntries(tree || []);
  const configs = entries.map(({ config }) => config);
  const metadataDirectory = path.dirname(treeFilePath);
  const appsDirectory = path.join(metadataDirectory, 'apps');

  await fs.rm(path.join(metadataDirectory, 'ecode-apps.json'), { force: true });

  if (!tree) {
    try {
      await fs.access(appsDirectory);
    } catch (appsError) {
      if ((appsError as NodeJS.ErrnoException).code === 'ENOENT') return configs;
      throw appsError;
    }
  }

  await fs.mkdir(appsDirectory, { recursive: true });
  const expectedFiles = new Set<string>();

  for (const { nodeId, config } of entries) {
    const fileName = getAppConfigFileName(nodeId);
    if (expectedFiles.has(fileName)) {
      throw new Error(`Duplicate eCode app node id "${nodeId}" in ecode-tree.json.`);
    }
    expectedFiles.add(fileName);
    await fs.writeFile(path.join(appsDirectory, fileName), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }

  for (const entry of await fs.readdir(appsDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json') && !expectedFiles.has(entry.name)) {
      await fs.rm(path.join(appsDirectory, entry.name), { force: true });
    }
  }

  return configs;
}
