import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import {
  loadEcodeAppConfigs,
  validateEcodeAppConfig,
  type EcodeAppConfig,
  type LoadEcodeAppConfigsOptions,
} from './app-config';
import { compileJavaScript } from './compiler';
import {
  createPathMetadata,
  findAppContext,
  findTypeChainByPath,
  normalizeTreePath,
  type EcodePathMetadata,
  type EcodeTreeItem,
} from './tree-utils';

const CONFIG_FILE_NAMES = new Set([
  'config.js',
  'configLoad.js',
  'config.json',
  'config_default.js',
  'configLoad_default.js',
  'config_default.json',
]);
const CODE_EXTENSIONS = new Set(['.css', '.js', '.json', '.md']);

type FileEntry = {
  path: string;
  relativePath: string;
  type: 'directory' | 'file';
};

type FileClassification = {
  config: boolean;
  jar: boolean;
  preState: boolean;
  resource: boolean;
};

type ConfigFile = FileEntry;

type ConfigParam = {
  content: string;
  compiledContent: string;
};

type UpgradeMetadataNode = {
  [key: string]: unknown;
};

type EcodeExportMetadata = {
  datas: UpgradeMetadataNode[];
};

type YazlZipFile = {
  outputStream: Readable;
  addEmptyDirectory(path: string, options?: { mtime?: Date }): void;
  addFile(filePath: string, archivePath: string, options?: { mtime?: Date }): void;
  on(event: 'error', listener: (error: Error) => void): void;
  end(): void;
};

const yazl: { ZipFile: new () => YazlZipFile } = require('yazl');

export type EcodeAppUpgradePackageOptions = LoadEcodeAppConfigsOptions & {
  /** Project containing src/, .ecode/apps/, and .ecode/ecode-tree.json. */
  projectRoot?: string;
  /** Exact eCode app IDs to include. At least one is required. */
  apps: string[];
  /** Optional in-memory app metadata. When provided, .ecode/apps/ is not read. */
  appConfigs?: EcodeAppConfig[];
  /** Caller-owned directory for the generated ZIP, plan, and checksum files. */
  outputDirectory: string;
  /** Defaults to <projectRoot>/.ecode/ecode-tree.json. */
  treeFilePath?: string;
};

type EcodeSelectedApp = {
  appConfig: EcodeAppConfig;
};

type EcodeUpgradeSelection = {
  projectRoot: string;
  selectedApps: EcodeSelectedApp[];
};

type EcodeUpgradeSelectionOptions = Pick<
  EcodeAppUpgradePackageOptions,
  'apps' | 'appConfigs' | 'appsDirectory' | 'projectRoot'
>;

export type EcodeUpgradeApp = {
  appId: string;
  appStatus: string;
  archive: string;
  fileCount: number;
  sourcePath: string;
};

type StagedApp = {
  app: EcodeUpgradeApp;
  ecode: EcodeExportMetadata;
};

export type EcodeUpgradePlan = {
  apps: EcodeUpgradeApp[];
  archive: string;
  checksum: string;
};

export type EcodeUpgradePackageResult = {
  archivePath: string;
  checksum: string;
  checksumPath: string;
  plan: EcodeUpgradePlan;
  planPath: string;
};

function readJsonFile(filePath: string): unknown {
  const value = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (!Array.isArray(value) && (!value || typeof value !== 'object')) {
    throw new Error(`Invalid JSON data in ${filePath}.`);
  }
  return value;
}

function writeJsonFile(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function walkDirectory(rootDirectory: string): FileEntry[] {
  const entries: FileEntry[] = [];

  function visit(directory: string, relativeDirectory: string): void {
    const children = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name, 'en')
    );

    for (const child of children) {
      const childPath = path.join(directory, child.name);
      const relativePath = normalizeTreePath(relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name);
      if (child.isSymbolicLink()) {
        throw new Error(`Symbolic links are not supported: ${childPath}`);
      }
      if (child.isDirectory()) {
        entries.push({ path: childPath, relativePath, type: 'directory' });
        visit(childPath, relativePath);
      } else if (child.isFile()) {
        entries.push({ path: childPath, relativePath, type: 'file' });
      }
    }
  }

  visit(path.resolve(rootDirectory), '');
  return entries;
}

function createFileClassifier(
  appConfig: EcodeAppConfig,
  pathMetadata: Map<string, EcodePathMetadata>
): (relativePath: string) => FileClassification {
  const configs = new Set(appConfig.configs.map(normalizeTreePath));
  const preStateFiles = new Set(appConfig.preStateFiles.map(normalizeTreePath));
  const resources = new Set(appConfig.resources.map(normalizeTreePath));

  return (relativePath: string) => {
    const normalizedPath = normalizeTreePath(relativePath);
    const metadata = pathMetadata.get(normalizedPath);
    const firstSegment = normalizedPath.split('/')[0]?.toLowerCase();
    const extension = path.extname(normalizedPath).toLowerCase();
    const jarDirectory = firstSegment === 'jar' || firstSegment === 'jars';
    const config = configs.has(normalizedPath) || metadata?.config === true || firstSegment === 'config';
    const jar = metadata?.jar === true || extension === '.jar' || jarDirectory;
    const resource =
      !config && !jar && (resources.has(normalizedPath) || metadata?.resource === true || firstSegment === 'resources');

    return {
      config,
      jar,
      preState: preStateFiles.has(normalizedPath) || metadata?.preState === true,
      resource,
    };
  };
}

function addEcodePrefix(name: string, prefix: string): string {
  return name.startsWith(prefix) ? name : `${prefix}${name}`;
}

function createExportRelativePath(
  relativePath: string,
  classification: FileClassification,
  pathMetadata: Map<string, EcodePathMetadata>
): string {
  const segments = normalizeTreePath(relativePath).split('/');

  return segments
    .map((segment, index) => {
      const originalPath = segments.slice(0, index + 1).join('/');
      const metadata = pathMetadata.get(originalPath);
      const isFile = index === segments.length - 1;
      const conventionResource = segments[0].toLowerCase() === 'resources';
      const conventionJar = ['jar', 'jars'].includes(segments[0].toLowerCase());
      const resource = metadata?.resource === true || (classification.resource && (isFile || conventionResource));
      const jar = metadata?.jar === true || (classification.jar && (isFile || conventionJar));
      if (resource) return addEcodePrefix(segment, '${');
      if (jar) return addEcodePrefix(segment, '&{');
      return segment;
    })
    .join('/');
}

const CONFIG_ID_PROPERTY_NAMES: Record<string, string> = {
  'config.js': 'config_id',
  'configLoad.js': 'configLoad_id',
  'config.json': 'configJson_id',
  'config_default.js': 'config_default_id',
  'configLoad_default.js': 'configLoad_default_id',
  'config_default.json': 'configJson_default_id',
};

function createConfParams(
  configFiles: ConfigFile[],
  pathMetadata: Map<string, EcodePathMetadata>
): Record<string, ConfigParam | string> {
  const confParams: Record<string, ConfigParam | string> = {};

  for (const file of configFiles) {
    const name = path.basename(file.relativePath);
    if (!CONFIG_FILE_NAMES.has(name)) {
      throw new Error(`Unsupported eCode config file "${file.relativePath}".`);
    }
    if (confParams[name]) {
      throw new Error(`Duplicate eCode config file name "${name}".`);
    }
    const content = readFileSync(file.path, 'utf8');
    confParams[name] = {
      content,
      compiledContent:
        path.extname(name).toLowerCase() === '.js' && content.trim()
          ? compileJavaScript(content, { filename: file.path })
          : content,
    };
    const configId = pathMetadata.get(normalizeTreePath(file.relativePath))?.node.id;
    const idPropertyName = CONFIG_ID_PROPERTY_NAMES[name];
    if (idPropertyName && configId) confParams[idPropertyName] = configId;
  }
  return confParams;
}

function createTypeTree(typeNodes: EcodeTreeItem[], appNode: UpgradeMetadataNode): UpgradeMetadataNode {
  let child = appNode;

  for (let index = typeNodes.length - 1; index >= 0; index -= 1) {
    const node = typeNodes[index];
    const parentId = index === 0 ? 'root' : validateEcodeId(typeNodes[index - 1].id, 'type id');
    child = {
      treeType: 'type',
      id: validateEcodeId(node.id, 'type id'),
      name: node.name,
      parentId,
      hasChild: true,
      children: [child],
    };
  }
  return child;
}

function buildAppMetadata(options: {
  appConfig: EcodeAppConfig;
  confParams: Record<string, ConfigParam | string>;
  tree: EcodeTreeItem[];
}): { context: ReturnType<typeof findAppContext>; ecode: EcodeExportMetadata; appId: string } {
  const { appConfig, confParams, tree } = options;
  const appId = validateEcodeId(appConfig.appId, 'app id');
  const context = findAppContext(tree, appId);
  const appNode = context?.appNode;
  const typeNodes = context?.typeNodes.length ? context.typeNodes : findTypeChainByPath(tree, appConfig.path);

  if (typeNodes.length === 0) {
    if (appNode?.attribute === 'system' || !appNode?.parentId) {
      throw new Error(
        `Root or system eCode nodes cannot be exported as application upgrade packages: "${appConfig.path}".`
      );
    }
    throw new Error(`Unable to resolve an eCode type chain for app "${appConfig.path}".`);
  }

  const parentTypeId = validateEcodeId(typeNodes[typeNodes.length - 1].id, 'type id');
  const metadata: UpgradeMetadataNode = {
    treeType: 'folder',
    id: appId,
    parentId: parentTypeId,
    hasChild: true,
    name: appNode?.name || path.posix.basename(normalizeTreePath(appConfig.path)),
    lockFlag: false,
    coverConfig: Boolean(appNode?.coverConfig),
    shareMd: appNode?.shareMd || 'n',
    debugMode: appNode?.debugMode || appConfig.debugMode || 'n',
    confParams,
    status: appConfig.appStatus || appNode?.status || '',
    keepAppIdFlag: true,
  };

  if (appNode?.caseVersion) metadata.caseVersion = appNode.caseVersion;
  return {
    context,
    ecode: { datas: [createTypeTree(typeNodes, metadata)] },
    appId,
  };
}

function normalizeArchiveText(content: string): string {
  const normalized = content.replace(/\r\n?/g, '\n').replace(/\n+$/g, '');
  return normalized ? `${normalized.replace(/\n/g, '\r\n')}\r\n` : '';
}

function normalizeAppExportMetadataNode(node: UpgradeMetadataNode): UpgradeMetadataNode {
  const children = Array.isArray(node.children)
    ? node.children.filter((child): child is UpgradeMetadataNode =>
        Boolean(child && typeof child === 'object' && !Array.isArray(child))
      )
    : [];
  const normalized: UpgradeMetadataNode = {
    ...node,
    coverConfig: Boolean(node.coverConfig),
    encoded: false,
    encrypted: false,
    exist: false,
    keepAppIdFlag: false,
    lockFlag: false,
    rootFolderFlag: false,
  };
  if (children.length > 0) normalized.children = children.map(normalizeAppExportMetadataNode);
  else delete normalized.children;
  return normalized;
}

function mergeMetadataNodes(target: UpgradeMetadataNode[], incoming: UpgradeMetadataNode[]): void {
  for (const incomingNode of incoming) {
    const nodeId = typeof incomingNode.id === 'string' ? incomingNode.id : undefined;
    const existing = nodeId ? target.find((node) => node.id === nodeId) : undefined;
    if (!existing) {
      target.push(incomingNode);
      continue;
    }
    if (existing.treeType !== incomingNode.treeType || existing.name !== incomingNode.name) {
      throw new Error(`Conflicting eCode metadata for node "${nodeId}".`);
    }
    const incomingChildren = Array.isArray(incomingNode.children)
      ? (incomingNode.children as UpgradeMetadataNode[])
      : [];
    if (incomingChildren.length === 0) continue;
    const existingChildren = Array.isArray(existing.children) ? (existing.children as UpgradeMetadataNode[]) : [];
    existing.children = existingChildren;
    mergeMetadataNodes(existingChildren, incomingChildren);
  }
}

function mergeAppExportMetadata(metadata: EcodeExportMetadata[]): EcodeExportMetadata {
  const merged: EcodeExportMetadata = { datas: [] };
  for (const value of metadata) {
    mergeMetadataNodes(merged.datas, value.datas.map(normalizeAppExportMetadataNode));
  }
  return merged;
}

function stageCodeFile(file: FileEntry, targetPath: string, classification: FileClassification): void {
  const extension = path.extname(file.relativePath).toLowerCase();
  const name = path.basename(targetPath);
  if (name.startsWith('compiled_')) {
    throw new Error(`Source file names must not start with compiled_: ${file.relativePath}`);
  }
  if (extension === '.jsx') {
    throw new Error(`JSX files must use a .js extension in eCode upgrade packages: ${file.relativePath}`);
  }
  if (!CODE_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported eCode source file "${file.relativePath}". Mark it as a resource or use js, css, json, or md.`
    );
  }

  mkdirSync(path.dirname(targetPath), { recursive: true });
  if (extension === '.js') {
    const rawSource = readFileSync(file.path, 'utf8');
    const source = normalizeArchiveText(rawSource);
    writeFileSync(targetPath, source, 'utf8');
    const compiledName = `${classification.preState ? 'compiled_prestate_' : 'compiled_'}${name}`;
    writeFileSync(
      path.join(path.dirname(targetPath), compiledName),
      compileJavaScript(source, { filename: file.path }),
      'utf8'
    );
  } else {
    const compiledName = `${classification.preState ? 'compiled_prestate_' : 'compiled_'}${name}`;
    const compiledPath = path.join(path.dirname(targetPath), compiledName);
    const source = normalizeArchiveText(readFileSync(file.path, 'utf8'));
    writeFileSync(targetPath, source, 'utf8');
    writeFileSync(compiledPath, source, 'utf8');
  }
}

function validateEcodeId(value: string | undefined, label = 'eCode id'): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label} is required.`);
  }
  if (!/^[0-9a-f]{32}$/i.test(value)) {
    throw new Error(`Invalid ${label} "${value}". Expected a 32-character hexadecimal UUID.`);
  }
  return value;
}

async function zipDirectory(sourceDirectory: string, outputPath: string, timestamp = new Date()): Promise<string[]> {
  const sourceRoot = path.resolve(sourceDirectory);
  const rootName = path.basename(sourceRoot);
  const rootPrefix = `${rootName}/`;
  const archive = new yazl.ZipFile();
  const archiveEntries: string[] = [];

  mkdirSync(path.dirname(outputPath), { recursive: true });
  archiveEntries.push(rootPrefix);
  archive.addEmptyDirectory(rootPrefix, { mtime: timestamp });
  for (const entry of walkDirectory(sourceRoot)) {
    const archivePath = `${rootPrefix}${entry.relativePath.replace(/\\/g, '/')}`;
    archiveEntries.push(entry.type === 'directory' ? `${archivePath}/` : archivePath);
    if (entry.type === 'directory') {
      archive.addEmptyDirectory(`${archivePath}/`, { mtime: timestamp });
    } else {
      archive.addFile(entry.path, archivePath, { mtime: timestamp });
    }
  }

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputPath);
    archive.on('error', reject);
    output.on('error', reject);
    output.on('close', resolve);
    archive.outputStream.pipe(output);
    archive.end();
  });
  return archiveEntries;
}

function createUpgradeSelection(options: EcodeUpgradeSelectionOptions): EcodeUpgradeSelection {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const selections = options.apps || [];
  if (selections.length === 0) throw new Error('At least one eCode app must be selected.');

  const currentApps = options.appConfigs
    ? options.appConfigs.map((appConfig, index) => validateEcodeAppConfig(appConfig, `appConfigs[${index}]`))
    : loadEcodeAppConfigs({
        projectRoot,
        appsDirectory: options.appsDirectory,
      });
  const currentAppsById = new Map<string, EcodeAppConfig>();
  const currentAppPaths = new Set<string>();
  for (const app of currentApps) {
    if (currentAppsById.has(app.appId)) throw new Error(`Duplicate eCode app id "${app.appId}".`);
    if (currentAppPaths.has(app.path)) throw new Error(`Duplicate eCode app path "${app.path}".`);
    currentAppsById.set(app.appId, app);
    currentAppPaths.add(app.path);
  }
  const selectedById = new Map<string, EcodeAppConfig>();
  for (const value of selections) {
    const app = currentAppsById.get(value);
    if (!app) throw new Error(`Unknown eCode app "${value}".`);
    selectedById.set(app.appId, app);
  }

  const selectedApps = Array.from(selectedById.values())
    .map((appConfig) => ({ appConfig }))
    .sort((left, right) => left.appConfig.path.localeCompare(right.appConfig.path, 'zh-CN'));
  for (const selectedApp of selectedApps) validateEcodeId(selectedApp.appConfig.appId, 'app id');
  const missingApps = selectedApps.filter(
    ({ appConfig }) => !existsSync(path.join(projectRoot, 'src', ...appConfig.path.split('/')))
  );
  if (missingApps.length > 0) {
    const names = missingApps.map((app) => app.appConfig.path).join(', ');
    throw new Error(`Selected eCode app source directories were not found: ${names}`);
  }
  return { projectRoot, selectedApps };
}

function readUpgradeTree(options: EcodeAppUpgradePackageOptions, projectRoot: string): EcodeTreeItem[] {
  const treePath = path.resolve(options.treeFilePath || path.join(projectRoot, '.ecode', 'ecode-tree.json'));
  const treeValue = readJsonFile(treePath);
  if (!Array.isArray(treeValue)) {
    throw new Error(`Invalid eCode tree in ${treePath}: expected an array.`);
  }
  return treeValue as EcodeTreeItem[];
}

function finalizeUpgradePackage(
  outputDirectory: string,
  archivePath: string,
  apps: EcodeUpgradeApp[]
): EcodeUpgradePackageResult {
  const checksum = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
  const completedPlan: EcodeUpgradePlan = {
    archive: path.basename(archivePath),
    checksum,
    apps,
  };
  const packageId = path.basename(archivePath, '.zip');
  const planPath = path.join(outputDirectory, `${packageId}.plan.json`);
  const checksumPath = path.join(outputDirectory, `${packageId}.sha256`);
  writeJsonFile(planPath, completedPlan);
  writeFileSync(checksumPath, `${checksum}  ${path.basename(archivePath)}\n`, 'utf8');
  return { archivePath, checksum, checksumPath, plan: completedPlan, planPath };
}

function stageApp(options: {
  appConfig: EcodeAppConfig;
  packageDirectory: string;
  projectRoot: string;
  tree: EcodeTreeItem[];
}): StagedApp {
  const { appConfig, packageDirectory, tree } = options;
  const sourceDirectory = path.join(options.projectRoot, 'src', ...appConfig.path.split('/'));
  const metadataPreview = buildAppMetadata({ appConfig, confParams: {}, tree });
  const appId = metadataPreview.appId;
  const pathMetadata = createPathMetadata(metadataPreview.context?.appNode);
  const classify = createFileClassifier(appConfig, pathMetadata);
  const sourceEntries = walkDirectory(sourceDirectory);
  const files = sourceEntries.filter((entry) => entry.type === 'file');
  const directories = sourceEntries.filter((entry) => entry.type === 'directory');
  const configFiles = files.filter((file) => classify(file.relativePath).config);
  const confParams = createConfParams(configFiles, pathMetadata);
  const appMetadata = buildAppMetadata({ appConfig, confParams, tree });
  const codeRoot = path.join(packageDirectory, appId);

  mkdirSync(codeRoot, { recursive: true });
  for (const directory of directories) {
    const classification = classify(directory.relativePath);
    if (classification.config) continue;
    const exportRelativePath = createExportRelativePath(directory.relativePath, classification, pathMetadata);
    mkdirSync(path.join(codeRoot, ...exportRelativePath.split('/')), { recursive: true });
  }
  for (const file of files) {
    const classification = classify(file.relativePath);
    if (classification.config) continue;
    const exportRelativePath = createExportRelativePath(file.relativePath, classification, pathMetadata);
    const targetPath = path.join(codeRoot, ...exportRelativePath.split('/'));
    if (classification.resource || classification.jar) {
      mkdirSync(path.dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, readFileSync(file.path));
    } else {
      stageCodeFile(file, targetPath, classification);
    }
  }

  return {
    app: {
      appId,
      appStatus: appConfig.appStatus,
      archive: `${appId}/`,
      fileCount: files.length,
      sourcePath: appConfig.path,
    },
    ecode: appMetadata.ecode,
  };
}

export async function buildAppUpgradePackage(
  options: EcodeAppUpgradePackageOptions
): Promise<EcodeUpgradePackageResult> {
  const selectedAppIds = options.apps || [];
  if (selectedAppIds.length === 0) {
    throw new Error('At least one eCode app must be selected.');
  }
  if (typeof options.outputDirectory !== 'string' || !options.outputDirectory.trim()) {
    throw new Error('An eCode app upgrade output directory is required.');
  }
  const selection = createUpgradeSelection({
    apps: selectedAppIds,
    appConfigs: options.appConfigs,
    appsDirectory: options.appsDirectory,
    projectRoot: options.projectRoot,
  });
  const outputDirectory = path.resolve(options.outputDirectory);
  const tree = readUpgradeTree(options, selection.projectRoot);
  const packageWorkDirectory = path.join(os.tmpdir(), `ecode-app-upgrade-${randomUUID().replace(/-/g, '')}`);
  const now = new Date();
  const packageId = `${now.getTime()}${randomUUID().replace(/-/g, '')}`;
  const packageDirectory = path.join(packageWorkDirectory, packageId);
  const archivePath = path.join(outputDirectory, `${packageId}.zip`);
  const generatedOutputPaths = new Set<string>();

  generatedOutputPaths.add(archivePath);
  generatedOutputPaths.add(path.join(outputDirectory, `${packageId}.plan.json`));
  generatedOutputPaths.add(path.join(outputDirectory, `${packageId}.sha256`));

  try {
    mkdirSync(packageDirectory, { recursive: true });
    const apps: EcodeUpgradeApp[] = [];
    const appMetadata: EcodeExportMetadata[] = [];
    for (const selectedApp of selection.selectedApps) {
      const stagedApp = stageApp({
        appConfig: selectedApp.appConfig,
        packageDirectory,
        projectRoot: selection.projectRoot,
        tree,
      });
      apps.push(stagedApp.app);
      appMetadata.push(stagedApp.ecode);
    }

    writeFileSync(
      path.join(packageDirectory, 'ecode.json'),
      JSON.stringify(mergeAppExportMetadata(appMetadata)),
      'utf8'
    );
    const entries = await zipDirectory(packageDirectory, archivePath, now);
    const packagePrefix = `${packageId}/`;
    for (const required of [`${packagePrefix}ecode.json`, ...apps.map((app) => `${packagePrefix}${app.appId}/`)]) {
      if (!entries.includes(required)) {
        throw new Error(`Generated app upgrade archive is missing ${required}.`);
      }
    }
    return finalizeUpgradePackage(outputDirectory, archivePath, apps);
  } catch (error) {
    for (const outputPath of generatedOutputPaths) {
      try {
        rmSync(outputPath, { force: true });
      } catch {
        // Preserve the original build error when Windows temporarily locks an output file.
      }
    }
    throw error;
  } finally {
    rmSync(packageWorkDirectory, { recursive: true, force: true });
  }
}
