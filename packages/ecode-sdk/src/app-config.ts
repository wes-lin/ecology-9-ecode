import { promises as fs, readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { getEcodeAppId, isTreeContainer, normalizeTreePath, walkEcodeTree, type EcodeTreeItem } from './tree-utils';

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
  walkEcodeTree(items, ({ node, relativePath }) => {
    indexed.push({
      item: node,
      path: relativePath,
      appId: getEcodeAppId(node),
      isContainer: isTreeContainer(node),
    });
  });
  return indexed;
}

function relativeDescendantPath(parentPath: string, candidatePath: string): string | undefined {
  const prefix = `${normalizeTreePath(parentPath)}/`;
  return candidatePath.startsWith(prefix) ? candidatePath.slice(prefix.length) : undefined;
}

function sortEcodePaths(paths: string[]): string[] {
  return paths.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
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
        sortEcodePaths(descendants.filter(({ file }) => predicate(file.item)).map(({ relativePath }) => relativePath));

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

function requireAppObject(value: unknown, sourcePath: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid eCode app config "${sourcePath}": expected a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, fieldName: string, sourcePath: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid eCode app config "${sourcePath}": "${fieldName}" must be a string.`);
  }
  return value;
}

const GLOB_CHARACTERS = /[*?[\]{}!]/;

function requireRelativePath(value: unknown, fieldName: string, sourcePath: string): string {
  const stringValue = requireString(value, fieldName, sourcePath);
  const segments = stringValue.split('/');
  if (
    !stringValue ||
    path.posix.isAbsolute(stringValue) ||
    path.win32.isAbsolute(stringValue) ||
    stringValue.includes('\\') ||
    stringValue.includes('\0') ||
    GLOB_CHARACTERS.test(stringValue) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(
      `Invalid eCode app config "${sourcePath}": "${fieldName}" contains an unsafe path "${stringValue}".`
    );
  }
  return stringValue;
}

function requirePathSegment(value: unknown, fieldName: string, sourcePath: string): string {
  const stringValue = requireRelativePath(value, fieldName, sourcePath);
  if (stringValue.includes('/')) {
    throw new Error(`Invalid eCode app config "${sourcePath}": "${fieldName}" must be a single path segment.`);
  }
  return stringValue;
}

function requirePathList(value: unknown, fieldName: string, sourcePath: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid eCode app config "${sourcePath}": "${fieldName}" must be an array.`);
  }
  return value.map((filePath, index) => requireRelativePath(filePath, `${fieldName}[${index}]`, sourcePath));
}

export function validateEcodeAppConfig(value: unknown, sourcePath: string): EcodeAppConfig {
  const appConfig = requireAppObject(value, sourcePath);
  requireRelativePath(appConfig.path, 'path', sourcePath);
  const appId = requirePathSegment(appConfig.appId, 'appId', sourcePath);
  const appStatus = requireString(appConfig.appStatus, 'appStatus', sourcePath);
  const appPreStateOrder = appConfig.appPreStateOrder;
  if (typeof appPreStateOrder !== 'number' || !Number.isFinite(appPreStateOrder)) {
    throw new Error(`Invalid eCode app config "${sourcePath}": "appPreStateOrder" must be a finite number.`);
  }
  const debugMode =
    appConfig.debugMode === undefined ? 'n' : requireString(appConfig.debugMode, 'debugMode', sourcePath);
  return {
    path: appConfig.path as string,
    appId,
    appStatus,
    appPreStateOrder,
    preStateFiles: requirePathList(appConfig.preStateFiles, 'preStateFiles', sourcePath),
    resources: requirePathList(appConfig.resources, 'resources', sourcePath),
    configs: requirePathList(appConfig.configs, 'configs', sourcePath),
    debugMode: debugMode as 'y' | 'n',
  };
}

export function readEcodeAppConfig(configPath: string): EcodeAppConfig {
  let contents: string;
  try {
    contents = readFileSync(configPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read eCode app config "${configPath}": ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Invalid eCode app config JSON "${configPath}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return validateEcodeAppConfig(value, configPath);
}

export type LoadEcodeAppConfigsOptions = {
  projectRoot?: string;
  appsDirectory?: string;
};

export function loadEcodeAppConfigs(options: LoadEcodeAppConfigsOptions = {}): EcodeAppConfig[] {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const appsDirectory = path.resolve(projectRoot, options.appsDirectory || path.join('.ecode', 'apps'));
  let entries;

  try {
    entries = readdirSync(appsDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `eCode app config directory not found: ${appsDirectory}. Run Download in the eCode plugin to generate it.`
      );
    }
    throw error;
  }

  const appIds = new Set<string>();
  const appPaths = new Set<string>();
  return entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const configPath = path.join(appsDirectory, entry.name);
      const appConfig = readEcodeAppConfig(configPath);
      if (appIds.has(appConfig.appId)) {
        throw new Error(`Duplicate eCode app id "${appConfig.appId}" in "${appsDirectory}".`);
      }
      if (appPaths.has(appConfig.path)) {
        throw new Error(`Duplicate eCode app path "${appConfig.path}" in "${appsDirectory}".`);
      }
      appIds.add(appConfig.appId);
      appPaths.add(appConfig.path);
      return appConfig;
    });
}
