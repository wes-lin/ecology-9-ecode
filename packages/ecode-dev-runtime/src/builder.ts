import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { compileJavaScript, loadEcodeAppConfigs, type EcodeAppConfig } from 'ecode-sdk';
import { getBundledPreStateBaseJavaScriptFiles } from './assets';
import { isPathInside, normalizePathKey, normalizeRelativePath, resolveInside, toPosixPath } from './paths';
import { NOOP_DEV_LOGGER, type EcodeDevBuildOptions, type EcodeDevBuildResult, type EcodeDevLogger } from './types';

type SourceFile = {
  absolutePath: string;
  relativePath: string;
  source: string;
  treeOrder?: number;
  importModules: string[];
  exportModules: string[];
};

type EcodeTreeNode = {
  id?: string;
  initialAppId?: string;
  name?: string;
  children?: EcodeTreeNode[];
};

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const results: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) results.push(entryPath);
    }
  }

  await visit(root);
  return results;
}

function parseModuleNames(contents: string, methodName: 'imp' | 'exp'): string[] {
  const names: string[] = [];
  const source = contents.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const pattern = new RegExp(`ecodeSDK\\.${methodName}\\(\\s*([A-Za-z_$][\\w$]*|["']([^"']+)["'])\\s*\\)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) names.push(match[2] || match[1]);
  return names;
}

function compareByTreeOrder(left: SourceFile, right: SourceFile): number {
  const leftHasOrder = Number.isInteger(left.treeOrder);
  const rightHasOrder = Number.isInteger(right.treeOrder);
  if (leftHasOrder && rightHasOrder && left.treeOrder !== right.treeOrder) {
    return (left.treeOrder as number) - (right.treeOrder as number);
  }
  if (leftHasOrder) return -1;
  if (rightHasOrder) return 1;
  return left.relativePath.localeCompare(right.relativePath);
}

function sortDependentModules(files: SourceFile[]): SourceFile[] {
  const sorted: SourceFile[] = [];
  const remaining = files.slice();
  while (remaining.length > 0) {
    const selectedIndex = remaining.findIndex(
      (candidate, candidateIndex) =>
        !remaining.some(
          (pending, pendingIndex) =>
            pendingIndex !== candidateIndex &&
            pending.exportModules.some((name) => candidate.importModules.includes(name))
        )
    );
    if (selectedIndex < 0) throw new Error('eCode JavaScript modules contain a circular dependency.');
    sorted.push(remaining.splice(selectedIndex, 1)[0]);
  }
  return sorted;
}

function sortJavaScriptFiles(files: SourceFile[]): SourceFile[] {
  const onlyExports: SourceFile[] = [];
  const ordinary: SourceFile[] = [];
  const dependentExports: SourceFile[] = [];
  const onlyImports: SourceFile[] = [];

  files.sort(compareByTreeOrder);
  for (const file of files) {
    if (file.importModules.length === 0 && file.exportModules.length > 0) onlyExports.push(file);
    else if (file.importModules.length === 0 && file.exportModules.length === 0) ordinary.push(file);
    else if (file.importModules.length > 0 && file.exportModules.length > 0) dependentExports.push(file);
    else onlyImports.push(file);
  }
  return onlyExports.concat(ordinary, sortDependentModules(dependentExports), onlyImports);
}

function removeUseStrict(source: string): string {
  return source.replace(/^\s*["']use strict["'];\s*/, '');
}

function applyAppId(source: string, appId: string): string {
  return source.replace(/\\?\$\{appId\}/g, appId);
}

function appendSourceComment(source: string, sourcePath: string): string {
  return `${source}\n/*\n路径：\n${sourcePath}\n*/\n`;
}

function wrapJavaScript(source: string): string {
  return `(function(){\n${source}\n})();`;
}

function isReleased(app: EcodeAppConfig): boolean {
  return app.appStatus === 'released' && app.debugMode !== 'y';
}

function findTreeApp(nodes: EcodeTreeNode[], appId: string): EcodeTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === appId || node.initialAppId === appId) return node;
    const found = findTreeApp(node.children || [], appId);
    if (found) return found;
  }
  return undefined;
}

function createTreeOrderMap(appNode: EcodeTreeNode | undefined): Map<string, number> {
  const orders = new Map<string, number>();
  let order = 0;
  function visit(nodes: EcodeTreeNode[] | undefined, parentPath: string): void {
    for (const node of nodes || []) {
      const relativePath = normalizeRelativePath(node.name ? `${parentPath}/${node.name}` : parentPath);
      if (!Array.isArray(node.children) && node.name && node.id) {
        orders.set(normalizePathKey(relativePath), order);
        order += 1;
      }
      visit(node.children, relativePath);
    }
  }
  visit(appNode?.children, '');
  return orders;
}

export class EcodeProjectBuilder {
  readonly projectRoot: string;
  readonly outputDirectory: string;
  readonly sourceDirectory: string;
  readonly appsDirectory: string;
  readonly treeFile: string;
  readonly preStateBaseJavaScriptFiles: string[];
  private readonly logger: EcodeDevLogger;

  constructor(options: EcodeDevBuildOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.outputDirectory = path.resolve(this.projectRoot, options.outputDirectory || 'dist');
    this.sourceDirectory = path.join(this.projectRoot, 'src');
    this.appsDirectory = path.resolve(this.projectRoot, options.appsDirectory || path.join('.ecode', 'apps'));
    this.treeFile = path.resolve(this.projectRoot, options.treeFile || path.join('.ecode', 'ecode-tree.json'));
    this.preStateBaseJavaScriptFiles = options.preStateBaseJavaScriptFiles
      ? options.preStateBaseJavaScriptFiles.map((filePath) => path.resolve(this.projectRoot, filePath))
      : getBundledPreStateBaseJavaScriptFiles();
    this.logger = options.logger || NOOP_DEV_LOGGER;

    if (!isPathInside(this.projectRoot, this.outputDirectory)) {
      throw new Error(`eCode output directory must be inside projectRoot: ${this.outputDirectory}`);
    }
  }

  async build(): Promise<EcodeDevBuildResult> {
    const startedAt = performance.now();
    const apps = this.loadReleasedApps();
    this.logger.info(`Building ${apps.length} released eCode app(s).`);
    await fs.rm(path.join(this.outputDirectory, 'release'), { recursive: true, force: true });
    await fs.rm(path.join(this.outputDirectory, 'dev'), { recursive: true, force: true });

    const tree = await this.readTree();
    for (const app of apps) await this.buildApp(app, tree);
    await this.buildPreState(apps);

    const result = {
      builtAppIds: apps.map((app) => app.appId),
      outputDirectory: this.outputDirectory,
      durationMs: elapsedSince(startedAt),
    };
    this.logger.info(`eCode build completed in ${result.durationMs}ms.`);
    return result;
  }

  async rebuildFile(filePath: string): Promise<EcodeDevBuildResult> {
    const startedAt = performance.now();
    const absolutePath = path.resolve(filePath);
    if (!isPathInside(this.projectRoot, absolutePath)) {
      throw new Error(`Changed file is outside projectRoot: ${absolutePath}`);
    }
    if (isPathInside(path.join(this.projectRoot, '.ecode'), absolutePath)) return this.build();
    if (!isPathInside(this.sourceDirectory, absolutePath)) {
      return { builtAppIds: [], outputDirectory: this.outputDirectory, durationMs: elapsedSince(startedAt) };
    }

    const apps = this.loadReleasedApps();
    const app = apps
      .map((candidate) => ({ candidate, root: this.getAppSourceDirectory(candidate) }))
      .filter(({ root }) => isPathInside(root, absolutePath))
      .sort((left, right) => right.root.length - left.root.length)[0]?.candidate;
    if (!app) {
      this.logger.debug(`No released eCode app owns ${absolutePath}.`);
      return { builtAppIds: [], outputDirectory: this.outputDirectory, durationMs: elapsedSince(startedAt) };
    }

    const tree = await this.readTree();
    await this.buildApp(app, tree);
    const relativePath = normalizePathKey(toPosixPath(path.relative(this.getAppSourceDirectory(app), absolutePath)));
    if (new Set(app.preStateFiles.map(normalizePathKey)).has(relativePath)) await this.buildPreState(apps);

    const result = {
      builtAppIds: [app.appId],
      outputDirectory: this.outputDirectory,
      durationMs: elapsedSince(startedAt),
    };
    this.logger.info(`Rebuilt eCode app ${app.appId} in ${result.durationMs}ms.`);
    return result;
  }

  async reloadConfiguration(): Promise<EcodeDevBuildResult> {
    return this.build();
  }

  private loadReleasedApps(): EcodeAppConfig[] {
    return loadEcodeAppConfigs({ projectRoot: this.projectRoot, appsDirectory: this.appsDirectory }).filter(isReleased);
  }

  private async readTree(): Promise<EcodeTreeNode[]> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.treeFile, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
      return parsed as EcodeTreeNode[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error(
        `Unable to read eCode tree "${this.treeFile}": ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private getAppSourceDirectory(app: EcodeAppConfig): string {
    return resolveInside(this.sourceDirectory, app.path, 'eCode app path');
  }

  private async buildApp(app: EcodeAppConfig, tree: EcodeTreeNode[]): Promise<void> {
    const sourceRoot = this.getAppSourceDirectory(app);
    const outputRoot = resolveInside(path.join(this.outputDirectory, 'release'), app.appId, 'eCode app output path');
    await fs.rm(outputRoot, { recursive: true, force: true });
    await fs.mkdir(outputRoot, { recursive: true });
    const files = await listFiles(sourceRoot);
    const relativePath = (filePath: string): string => toPosixPath(path.relative(sourceRoot, filePath));
    const preStateFiles = new Set(app.preStateFiles.map(normalizePathKey));
    const resourceFiles = new Set(app.resources.map(normalizePathKey));
    const configFiles = new Set(app.configs.map(normalizePathKey));
    const treeOrders = createTreeOrderMap(findTreeApp(tree, app.appId));

    const javaScriptFiles: SourceFile[] = [];
    for (const filePath of files) {
      const relative = relativePath(filePath);
      const key = normalizePathKey(relative);
      if (!/\.(js|jsx)$/i.test(relative) || preStateFiles.has(key) || resourceFiles.has(key) || configFiles.has(key)) {
        continue;
      }
      const source = await fs.readFile(filePath, 'utf8');
      javaScriptFiles.push({
        absolutePath: filePath,
        relativePath: relative,
        source,
        treeOrder: treeOrders.get(key),
        importModules: parseModuleNames(source, 'imp'),
        exportModules: parseModuleNames(source, 'exp'),
      });
    }

    const compiledJavaScript = sortJavaScriptFiles(javaScriptFiles)
      .map((file) => {
        const compiled = removeUseStrict(
          compileJavaScript(applyAppId(file.source, app.appId), { filename: file.absolutePath })
        );
        return appendSourceComment(compiled, `${app.path}/${file.relativePath}`);
      })
      .join('');
    if (javaScriptFiles.length > 0) {
      await fs.writeFile(path.join(outputRoot, 'index.js'), wrapJavaScript(compiledJavaScript), 'utf8');
    }

    const cssFiles = files
      .filter((filePath) => /\.css$/i.test(filePath) && !resourceFiles.has(normalizePathKey(relativePath(filePath))))
      .sort((left, right) => relativePath(left).localeCompare(relativePath(right)));
    const css = (await Promise.all(cssFiles.map((filePath) => fs.readFile(filePath, 'utf8')))).join('');
    await fs.writeFile(path.join(outputRoot, 'index.css'), css, 'utf8');

    for (const resource of app.resources) {
      const sourcePath = resolveInside(sourceRoot, resource, 'eCode resource path');
      if (!(await exists(sourcePath))) continue;
      const destinationPath = resolveInside(outputRoot, resource, 'eCode resource output path');
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.copyFile(sourcePath, destinationPath);
    }
  }

  private async buildPreState(apps: EcodeAppConfig[]): Promise<void> {
    const devOutput = path.join(this.outputDirectory, 'dev');
    await fs.mkdir(devOutput, { recursive: true });
    const orderedApps = apps.slice().sort((left, right) => left.appPreStateOrder - right.appPreStateOrder);
    const javaScriptParts: string[] = [];
    const cssParts: string[] = [];

    for (const app of orderedApps) {
      const sourceRoot = this.getAppSourceDirectory(app);
      for (const relativePath of app.preStateFiles) {
        const sourcePath = resolveInside(sourceRoot, relativePath, 'eCode pre-state path');
        if (!(await exists(sourcePath))) continue;
        const source = await fs.readFile(sourcePath, 'utf8');
        const commentPath = `${app.path}/${relativePath}(${app.appId})`;
        if (/\.(js|jsx)$/i.test(relativePath)) {
          const compiled = removeUseStrict(compileJavaScript(applyAppId(source, app.appId), { filename: sourcePath }));
          javaScriptParts.push(wrapJavaScript(appendSourceComment(compiled, commentPath)));
        } else if (/\.css$/i.test(relativePath)) {
          cssParts.push(appendSourceComment(source, commentPath));
        }
      }
    }

    const initJavaScriptPath = path.join(devOutput, 'init.js');
    if (javaScriptParts.length > 0) {
      const baseParts: string[] = [];
      for (const filePath of this.preStateBaseJavaScriptFiles) {
        try {
          baseParts.push(await fs.readFile(filePath, 'utf8'));
        } catch (error) {
          throw new Error(
            `Unable to read eCode pre-state base JavaScript "${filePath}": ${error instanceof Error ? error.message : error}`
          );
        }
      }
      await fs.writeFile(initJavaScriptPath, baseParts.concat(javaScriptParts).join(''), 'utf8');
    } else {
      await fs.rm(initJavaScriptPath, { force: true });
    }

    const initCssPath = path.join(devOutput, 'init.css');
    if (cssParts.length > 0) await fs.writeFile(initCssPath, cssParts.join(''), 'utf8');
    else await fs.rm(initCssPath, { force: true });
  }
}
