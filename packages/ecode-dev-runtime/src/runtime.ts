import { existsSync, watch, type FSWatcher } from 'node:fs';
import * as path from 'node:path';
import { EcodeProjectBuilder } from './builders/project';
import { EcodeDevProxyServer } from './proxy';
import {
  NOOP_DEV_LOGGER,
  type EcodeDevBuildResult,
  type EcodeDevRuntimeOptions,
  type EcodeDevServerAddress,
  type EcodeDevLogger,
} from './types';

export class EcodeDevRuntime {
  readonly builder: EcodeProjectBuilder;
  private readonly options: EcodeDevRuntimeOptions;
  private readonly logger: EcodeDevLogger;
  private proxy?: EcodeDevProxyServer;
  private watchers: FSWatcher[] = [];
  private debounceTimer?: NodeJS.Timeout;
  private pendingFiles = new Set<string>();
  private buildQueue: Promise<unknown> = Promise.resolve();

  constructor(options: EcodeDevRuntimeOptions) {
    this.options = { ...options, projectRoot: path.resolve(options.projectRoot) };
    this.logger = options.logger || NOOP_DEV_LOGGER;
    this.builder = new EcodeProjectBuilder(this.options);
  }

  build(): Promise<EcodeDevBuildResult> {
    return this.enqueue(() => this.builder.build());
  }

  prepare(): Promise<EcodeDevBuildResult> {
    return this.enqueue(() => this.builder.prepare());
  }

  rebuildFile(filePath: string): Promise<EcodeDevBuildResult> {
    return this.enqueue(() => this.builder.rebuildFile(filePath));
  }

  rebuildFiles(filePaths: string[]): Promise<EcodeDevBuildResult> {
    return this.enqueue(() => this.builder.rebuildFiles(filePaths));
  }

  reloadConfiguration(): Promise<EcodeDevBuildResult> {
    return this.enqueue(() => this.builder.reloadConfiguration());
  }

  async startProxy(): Promise<EcodeDevServerAddress> {
    if (!this.options.proxyTarget) throw new Error('proxyTarget is required to start the eCode development proxy.');
    if (!this.proxy) {
      this.proxy = new EcodeDevProxyServer({
        projectRoot: this.options.projectRoot,
        outputDirectory: this.options.outputDirectory,
        target: this.options.proxyTarget,
        host: this.options.host,
        port: this.options.port,
        changeOrigin: this.options.changeOrigin,
        strictSSL: this.options.strictSSL,
        rewriteCookies: this.options.rewriteCookies,
        rewriteRedirects: this.options.rewriteRedirects,
        logger: this.logger,
      });
    }
    return this.proxy.start();
  }

  async stopProxy(): Promise<void> {
    const proxy = this.proxy;
    this.proxy = undefined;
    await proxy?.stop();
  }

  startWatching(): void {
    if (this.watchers.length > 0) return;
    const roots = [path.join(this.options.projectRoot, 'src'), path.join(this.options.projectRoot, '.ecode')];
    for (const root of roots) {
      if (!existsSync(root)) continue;
      const watcher = watch(root, { recursive: true }, (_eventType, fileName) => {
        this.pendingFiles.add(fileName ? path.join(root, fileName.toString()) : root);
        this.scheduleChanges();
      });
      watcher.on('error', (error) => this.logger.error(`eCode watcher failed for ${root}.`, error));
      this.watchers.push(watcher);
    }
    this.logger.info('eCode source watcher started.');
  }

  stopWatching(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    this.pendingFiles.clear();
    this.watchers.splice(0).forEach((watcher) => watcher.close());
    this.logger.info('eCode source watcher stopped.');
  }

  async start(): Promise<EcodeDevServerAddress> {
    await this.prepare();
    this.startWatching();
    try {
      return await this.startProxy();
    } catch (error) {
      this.stopWatching();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.stopWatching();
    await this.stopProxy();
    await this.buildQueue.catch(() => undefined);
    await this.builder.flushBuildState();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.buildQueue.catch(() => undefined).then(operation);
    this.buildQueue = result;
    return result;
  }

  private scheduleChanges(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      const files = [...this.pendingFiles];
      this.pendingFiles.clear();
      const metadataChanged = files.some(
        (filePath) => path.basename(filePath) === 'ecode-tree.json' || filePath.includes(`${path.sep}apps${path.sep}`)
      );
      const operation = metadataChanged ? this.reloadConfiguration() : this.rebuildFiles(files);
      operation.catch((error) => this.logger.error('Automatic eCode rebuild failed.', error));
    }, this.options.watchDebounceMs ?? 80);
  }
}

export function createEcodeDevRuntime(options: EcodeDevRuntimeOptions): EcodeDevRuntime {
  return new EcodeDevRuntime(options);
}
