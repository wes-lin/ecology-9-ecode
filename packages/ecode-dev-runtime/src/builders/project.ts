import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { loadEcodeAppConfigs, type EcodeAppConfig } from 'ecode-sdk';
import { getBundledPreStateBaseJavaScriptFiles } from '../assets';
import { isPathInside, normalizePathKey, normalizeRelativePath, resolveInside, toPosixPath } from '../paths';
import { NOOP_DEV_LOGGER, type EcodeDevBuildOptions, type EcodeDevBuildResult, type EcodeDevLogger } from '../types';
import { buildAppCss } from './app-css';
import { buildAppJavaScript } from './app-javascript';
import { EcodeBuildStateStore, type EcodeBuildState } from './build-state';
import { EcodePreStateBuilder } from './prestate';
import { copyAppResources, rebuildResource } from './resource';

type EcodeTreeNode = {
  id?: string;
  initialAppId?: string;
  name?: string;
  children?: EcodeTreeNode[];
};

type AppRebuildTarget = {
  app: EcodeAppConfig;
  javaScript: boolean;
  css: boolean;
  resources: Set<string>;
};

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function isReleased(app: EcodeAppConfig): boolean {
  return app.appStatus === 'released' && app.debugMode !== 'y';
}

function createTreeNodeIndex(nodes: EcodeTreeNode[]): Map<string, EcodeTreeNode> {
  const nodesById = new Map<string, EcodeTreeNode>();
  function visit(items: EcodeTreeNode[] | undefined): void {
    for (const node of items || []) {
      if (node.id) nodesById.set(node.id, node);
      if (node.initialAppId && !nodesById.has(node.initialAppId)) nodesById.set(node.initialAppId, node);
      visit(node.children);
    }
  }
  visit(nodes);
  return nodesById;
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
  private readonly preStateBuilder: EcodePreStateBuilder;
  private readonly buildStateStore: EcodeBuildStateStore;
  private cachedBuildState?: EcodeBuildState;
  private buildStateDirty = false;
  private cachedReleasedApps?: EcodeAppConfig[];
  private cachedAppRoots?: Array<{ app: EcodeAppConfig; root: string }>;
  private cachedTree?: EcodeTreeNode[];
  private cachedTreeNodes?: Map<string, EcodeTreeNode>;
  private cachedTreeOrders = new Map<string, Map<string, number>>();

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
    this.preStateBuilder = new EcodePreStateBuilder({
      sourceDirectory: this.sourceDirectory,
      outputDirectory: this.outputDirectory,
      baseJavaScriptFiles: this.preStateBaseJavaScriptFiles,
    });
    this.buildStateStore = new EcodeBuildStateStore({
      projectRoot: this.projectRoot,
      sourceDirectory: this.sourceDirectory,
      appsDirectory: this.appsDirectory,
      treeFile: this.treeFile,
      outputDirectory: this.outputDirectory,
      baseJavaScriptFiles: this.preStateBaseJavaScriptFiles,
    });

    if (!isPathInside(this.projectRoot, this.outputDirectory)) {
      throw new Error(`eCode output directory must be inside projectRoot: ${this.outputDirectory}`);
    }
  }

  async build(): Promise<EcodeDevBuildResult> {
    const startedAt = performance.now();
    this.invalidateConfigurationCache();
    const apps = this.loadReleasedApps();
    this.logger.info(`Building ${apps.length} released eCode app(s).`);
    await fs.rm(path.join(this.outputDirectory, 'release'), { recursive: true, force: true });
    await fs.rm(path.join(this.outputDirectory, 'dev'), { recursive: true, force: true });

    const tree = await this.readTree();
    for (const [index, app] of apps.entries()) {
      this.logger.info(`[${index + 1}/${apps.length}] Building eCode app ${app.appId}.`);
      await this.buildApp(app, tree);
    }
    this.logger.info('Building global eCode pre-state output.');
    await this.preStateBuilder.build(apps);
    await this.recreateBuildState();

    const result = {
      builtAppIds: apps.map((app) => app.appId),
      outputDirectory: this.outputDirectory,
      durationMs: elapsedSince(startedAt),
    };
    this.logger.info(`eCode build completed in ${result.durationMs}ms.`);
    return result;
  }

  async prepare(): Promise<EcodeDevBuildResult> {
    const startedAt = performance.now();
    this.invalidateConfigurationCache();
    const state = await this.buildStateStore.load();
    if (!state) {
      this.logger.info('No reusable eCode build state found; performing a full build.');
      return this.build();
    }

    const metadata = await this.buildStateStore.captureMetadata();
    if (!this.buildStateStore.metadataMatches(state, metadata)) {
      this.logger.info('eCode build metadata changed; performing a full build.');
      return this.build();
    }
    if (!(await this.buildStateStore.outputsMatch(state))) {
      this.logger.info('eCode build output is incomplete or changed; performing a full build.');
      return this.build();
    }

    const apps = this.loadReleasedApps();
    if (!this.preStateBuilder.restoreCache(apps, state.preState)) {
      this.logger.info('eCode pre-state cache is incompatible; performing a full build.');
      return this.build();
    }

    const sources = await this.buildStateStore.captureSources();
    const changedFiles = this.buildStateStore.diffSources(state, sources);
    this.cachedBuildState = state;
    state.metadata = metadata;
    if (changedFiles.length === 0) {
      state.sources = sources;
      const result = { builtAppIds: [], outputDirectory: this.outputDirectory, durationMs: elapsedSince(startedAt) };
      this.logger.info(`Reused current eCode build output in ${result.durationMs}ms.`);
      return result;
    }

    this.logger.info(`Found ${changedFiles.length} source change(s) since the previous eCode build.`);
    const result = await this.rebuildFiles(changedFiles);
    await this.recreateBuildState();
    result.durationMs = elapsedSince(startedAt);
    this.logger.info(`eCode startup build preparation completed in ${result.durationMs}ms.`);
    return result;
  }

  async rebuildFile(filePath: string): Promise<EcodeDevBuildResult> {
    return this.rebuildFiles([filePath]);
  }

  async rebuildFiles(filePaths: string[]): Promise<EcodeDevBuildResult> {
    const startedAt = performance.now();
    const changedFiles = new Map<string, string>();
    for (const filePath of filePaths) {
      const absolutePath = path.resolve(filePath);
      if (!isPathInside(this.projectRoot, absolutePath)) {
        throw new Error(`Changed file is outside projectRoot: ${absolutePath}`);
      }
      changedFiles.set(normalizePathKey(absolutePath), absolutePath);
    }
    const absolutePaths = [...changedFiles.values()];
    if (absolutePaths.some((absolutePath) => isPathInside(path.join(this.projectRoot, '.ecode'), absolutePath))) {
      return this.build();
    }

    const apps = this.loadReleasedApps();
    const appRoots = this.getAppRoots();
    const appTargets = new Map<string, AppRebuildTarget>();
    const preStateJavaScriptFiles = new Map<string, string>();
    const preStateCssFiles = new Map<string, string>();
    const builtAppIds = new Set<string>();

    for (const absolutePath of absolutePaths) {
      if (!isPathInside(this.sourceDirectory, absolutePath)) continue;
      const app = appRoots.find(({ root }) => isPathInside(root, absolutePath))?.app;
      if (!app) {
        this.logger.debug(`No released eCode app owns ${absolutePath}.`);
        continue;
      }

      const relativePath = normalizePathKey(toPosixPath(path.relative(this.getAppSourceDirectory(app), absolutePath)));
      const preStateFiles = new Set(app.preStateFiles.map(normalizePathKey));
      const resourceFiles = new Set(app.resources.map(normalizePathKey));
      const configFiles = new Set(app.configs.map(normalizePathKey));
      if (configFiles.has(relativePath)) {
        this.logger.debug(`Skipped excluded config ${absolutePath}.`);
        continue;
      }

      if (preStateFiles.has(relativePath) && /\.(js|jsx)$/i.test(relativePath)) {
        preStateJavaScriptFiles.set(normalizePathKey(absolutePath), absolutePath);
      } else if (preStateFiles.has(relativePath) && /\.css$/i.test(relativePath)) {
        preStateCssFiles.set(normalizePathKey(absolutePath), absolutePath);
      } else {
        let target = appTargets.get(app.appId);
        if (!target) {
          target = { app, javaScript: false, css: false, resources: new Set<string>() };
          appTargets.set(app.appId, target);
        }
        if (resourceFiles.has(relativePath)) target.resources.add(relativePath);
        else if (/\.(js|jsx)$/i.test(relativePath)) target.javaScript = true;
        else if (/\.css$/i.test(relativePath)) target.css = true;
        else {
          this.logger.debug(`Skipped unmanaged file ${absolutePath}.`);
          continue;
        }
      }
      builtAppIds.add(app.appId);
    }

    const targets = [...appTargets.values()];
    const javaScriptTargets = targets.filter((target) => target.javaScript);
    const cssTargetCount = targets.filter((target) => target.css).length;
    const resourceTargetCount = targets.reduce((count, target) => count + target.resources.size, 0);
    const preStateTaskCount = Number(preStateJavaScriptFiles.size > 0) + Number(preStateCssFiles.size > 0);
    const plannedTaskCount = javaScriptTargets.length + cssTargetCount + resourceTargetCount + preStateTaskCount;
    if (plannedTaskCount > 0) {
      this.logger.info(
        `Rebuilding ${builtAppIds.size} eCode app(s): ${javaScriptTargets.length} JavaScript, ${cssTargetCount} CSS, ${resourceTargetCount} resource, and ${preStateTaskCount} pre-state task(s).`
      );
    }
    const tree = javaScriptTargets.length > 0 ? await this.readTree() : undefined;
    const tasks: Promise<void>[] = [];

    for (const target of targets) {
      const sourceRoot = this.getAppSourceDirectory(target.app);
      const outputRoot = this.getAppOutputDirectory(target.app);
      if (target.javaScript) {
        tasks.push(buildAppJavaScript(target.app, sourceRoot, outputRoot, this.getTreeOrders(tree!, target.app.appId)));
      }
      if (target.css) tasks.push(buildAppCss(target.app, sourceRoot, outputRoot));
      for (const relativePath of target.resources) {
        tasks.push(rebuildResource(target.app, sourceRoot, outputRoot, relativePath));
      }
    }
    if (preStateJavaScriptFiles.size > 0) {
      tasks.push(this.preStateBuilder.buildJavaScript(apps, [...preStateJavaScriptFiles.values()]));
    }
    if (preStateCssFiles.size > 0) {
      tasks.push(this.preStateBuilder.buildCss(apps, [...preStateCssFiles.values()]));
    }
    await Promise.all(tasks);
    await this.updateBuildStateSources(absolutePaths);

    const result = {
      builtAppIds: [...builtAppIds],
      outputDirectory: this.outputDirectory,
      durationMs: elapsedSince(startedAt),
    };
    if (tasks.length > 0) {
      this.logger.info(
        `Rebuilt ${result.builtAppIds.length} eCode app(s) with ${tasks.length} parallel task(s) in ${result.durationMs}ms.`
      );
    }
    return result;
  }

  async reloadConfiguration(): Promise<EcodeDevBuildResult> {
    return this.build();
  }

  async flushBuildState(): Promise<void> {
    if (!this.cachedBuildState || !this.buildStateDirty) return;
    await this.recreateBuildState();
  }

  private loadReleasedApps(): EcodeAppConfig[] {
    if (!this.cachedReleasedApps) {
      this.cachedReleasedApps = loadEcodeAppConfigs({
        projectRoot: this.projectRoot,
        appsDirectory: this.appsDirectory,
      }).filter(isReleased);
    }
    return this.cachedReleasedApps;
  }

  private getAppRoots(): Array<{ app: EcodeAppConfig; root: string }> {
    if (!this.cachedAppRoots) {
      this.cachedAppRoots = this.loadReleasedApps()
        .map((app) => ({ app, root: this.getAppSourceDirectory(app) }))
        .sort((left, right) => right.root.length - left.root.length);
    }
    return this.cachedAppRoots;
  }

  private invalidateConfigurationCache(): void {
    this.cachedReleasedApps = undefined;
    this.cachedAppRoots = undefined;
    this.cachedTree = undefined;
    this.cachedTreeNodes = undefined;
    this.cachedTreeOrders.clear();
    this.preStateBuilder.reset();
    this.cachedBuildState = undefined;
    this.buildStateDirty = false;
  }

  private async recreateBuildState(): Promise<void> {
    const preState = this.preStateBuilder.createCache();
    if (!preState) return;
    try {
      this.cachedBuildState = await this.buildStateStore.create(preState);
      await this.buildStateStore.save(this.cachedBuildState);
      this.buildStateDirty = false;
    } catch (error) {
      this.cachedBuildState = undefined;
      this.buildStateDirty = false;
      this.logger.warn('Unable to save reusable eCode build state.', error);
    }
  }

  private async updateBuildStateSources(filePaths: string[]): Promise<void> {
    if (!this.cachedBuildState) return;
    await this.buildStateStore.updateSources(this.cachedBuildState, filePaths);
    const preState = this.preStateBuilder.createCache();
    if (preState) this.cachedBuildState.preState = preState;
    this.buildStateDirty = true;
  }

  private async readTree(): Promise<EcodeTreeNode[]> {
    if (this.cachedTree) return this.cachedTree;
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.treeFile, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
      this.cachedTree = parsed as EcodeTreeNode[];
      return this.cachedTree;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cachedTree = [];
        return this.cachedTree;
      }
      throw new Error(
        `Unable to read eCode tree "${this.treeFile}": ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private getAppSourceDirectory(app: EcodeAppConfig): string {
    return resolveInside(this.sourceDirectory, app.path, 'eCode app path');
  }

  private getAppOutputDirectory(app: EcodeAppConfig): string {
    return resolveInside(path.join(this.outputDirectory, 'release'), app.appId, 'eCode app output path');
  }

  private getTreeOrders(tree: EcodeTreeNode[], appId: string): Map<string, number> {
    let orders = this.cachedTreeOrders.get(appId);
    if (!orders) {
      this.cachedTreeNodes ||= createTreeNodeIndex(tree);
      orders = createTreeOrderMap(this.cachedTreeNodes.get(appId));
      this.cachedTreeOrders.set(appId, orders);
    }
    return orders;
  }

  private async buildApp(app: EcodeAppConfig, tree: EcodeTreeNode[]): Promise<void> {
    const sourceRoot = this.getAppSourceDirectory(app);
    const outputRoot = this.getAppOutputDirectory(app);
    await fs.rm(outputRoot, { recursive: true, force: true });
    await fs.mkdir(outputRoot, { recursive: true });
    await buildAppJavaScript(app, sourceRoot, outputRoot, this.getTreeOrders(tree, app.appId));
    await buildAppCss(app, sourceRoot, outputRoot);
    await copyAppResources(app, sourceRoot, outputRoot);
  }
}
