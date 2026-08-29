import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  BUNDLED_ECODE_ASSETS,
  EcodeProjectBuilder,
  createEcodeDevRuntime,
  type EcodeDevLogger,
  type EcodeDevRuntime,
  type EcodeDevRuntimeOptions,
  type EcodeDevServerAddress,
} from 'ecode-dev-runtime';
import { getEcodeDevServer } from '../config/ecodeDevServer';
import {
  getActiveEcodeEnvironment,
  getActiveEcodeEnvironmentRoot,
  normalizeEnvironmentBaseUrl,
} from '../config/ecodeEnvironment';
import { getErrorMessage } from '../utils/errors';

class OutputChannelLogger implements EcodeDevLogger {
  constructor(private readonly output: vscode.OutputChannel) {}

  debug(message: string, data?: unknown): void {
    this.write('DEBUG', message, data);
  }

  info(message: string, data?: unknown): void {
    this.write('INFO', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write('WARN', message, data);
  }

  error(message: string, data?: unknown): void {
    this.write('ERROR', message, data);
  }

  private write(level: string, message: string, data?: unknown): void {
    const detail = this.formatData(data);
    this.output.appendLine(`${new Date().toISOString()} [${level}] ${message}${detail ? `\n${detail}` : ''}`);
  }

  private formatData(data: unknown): string {
    if (data === undefined) return '';
    if (data instanceof Error) return data.stack || data.message;
    if (typeof data === 'string') return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }
}

export class EcodeDevSessionManager implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('eCode Dev');
  private readonly logger = new OutputChannelLogger(this.output);
  private readonly statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private runtime?: EcodeDevRuntime;
  private address?: EcodeDevServerAddress;
  private fileWatchers: vscode.FileSystemWatcher[] = [];
  private watchDebounceTimer?: NodeJS.Timeout;
  private readonly pendingSourceFiles = new Set<string>();
  private metadataChanged = false;
  private operationQueue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.statusBar.command = 'ecode.dev.open';
    void vscode.commands.executeCommand('setContext', 'ecode.dev.running', false);
    void vscode.commands.executeCommand('setContext', 'ecode.dev.busy', false);
  }

  start(): Promise<void> {
    return this.enqueue(() => this.startInternal());
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.stopInternal(true));
  }

  restart(): Promise<void> {
    return this.enqueue(async () => {
      await this.stopInternal(false);
      await this.startInternal();
    });
  }

  shutdown(): Promise<void> {
    return this.enqueue(() => this.stopInternal(false));
  }

  build(): Promise<void> {
    return this.enqueue(async () => {
      if (!vscode.workspace.isTrusted) {
        throw new Error('Trust this workspace before building local eCode apps.');
      }
      this.output.show(true);
      const result = this.runtime
        ? await this.runtime.build()
        : await new EcodeProjectBuilder(this.getRuntimeOptions()).build();
      vscode.window.showInformationMessage(
        `Built ${result.builtAppIds.length} local eCode app(s) in ${result.durationMs}ms.`
      );
    });
  }

  async open(): Promise<void> {
    if (!this.address) {
      vscode.window.showWarningMessage('Local eCode debugging is not running.');
      return;
    }
    const devServer = getEcodeDevServer(vscode.workspace.getConfiguration('ecode'));
    const openPath = devServer.openPath;
    const target = new URL(`/${openPath.replace(/^\/+/, '')}`, `${this.address.url}/`);
    const externalUri = await vscode.env.asExternalUri(vscode.Uri.parse(target.toString()));
    await vscode.env.openExternal(externalUri);
  }

  async handleConfigurationChange(event: vscode.ConfigurationChangeEvent): Promise<void> {
    if (!this.runtime) return;
    if (
      event.affectsConfiguration('ecode.environments') ||
      event.affectsConfiguration('ecode.activeEnvironment') ||
      event.affectsConfiguration('ecode.devServer')
    ) {
      await this.stop();
      vscode.window.showInformationMessage('Local eCode debugging stopped because its configuration changed.');
    }
  }

  showOutput(): void {
    this.output.show(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.shutdown().finally(() => {
      this.statusBar.dispose();
      this.output.dispose();
    });
  }

  private async startInternal(): Promise<void> {
    if (this.runtime && this.address) {
      vscode.window.showInformationMessage(`Local eCode debugging is already running at ${this.address.url}.`);
      return;
    }
    if (!vscode.workspace.isTrusted) {
      throw new Error('Trust this workspace before starting local eCode debugging.');
    }

    this.output.show(true);
    const options = this.getRuntimeOptions();
    const runtime = createEcodeDevRuntime(options);
    try {
      await runtime.build();
      const address = await runtime.startProxy();
      this.runtime = runtime;
      this.address = address;
      this.startFileWatching(options.projectRoot);
      await vscode.commands.executeCommand('setContext', 'ecode.dev.running', true);
      this.statusBar.text = `$(debug-alt) eCode Dev :${address.port}`;
      this.statusBar.tooltip = `Local eCode debugging proxying ${options.proxyTarget}`;
      this.statusBar.show();
      vscode.window.showInformationMessage(`Local eCode debugging started at ${address.url}.`);
      if (getEcodeDevServer(vscode.workspace.getConfiguration('ecode')).autoOpen) await this.open();
    } catch (error) {
      await runtime.dispose();
      throw error;
    }
  }

  private async stopInternal(notify: boolean): Promise<void> {
    const runtime = this.runtime;
    const wasRunning = Boolean(runtime || this.address);
    this.runtime = undefined;
    this.address = undefined;
    this.stopFileWatching();
    this.statusBar.hide();
    await vscode.commands.executeCommand('setContext', 'ecode.dev.running', false);
    await runtime?.dispose();
    if (notify && wasRunning) vscode.window.showInformationMessage('Local eCode debugging stopped.');
  }

  private getRuntimeOptions(): EcodeDevRuntimeOptions {
    const ecodeConfiguration = vscode.workspace.getConfiguration('ecode');
    const environment = getActiveEcodeEnvironment(ecodeConfiguration);
    if (!environment) throw new Error('No eCode environment configured.');
    if (!environment.baseUrl) throw new Error(`Environment "${environment.name}" is missing baseUrl.`);
    const devServer = getEcodeDevServer(ecodeConfiguration);
    const assetDirectory = path.join(this.extensionUri.fsPath, 'dist', 'runtime-assets', 'ecode');
    return {
      projectRoot: getActiveEcodeEnvironmentRoot(ecodeConfiguration),
      proxyTarget: normalizeEnvironmentBaseUrl(environment.baseUrl),
      host: devServer.host,
      port: devServer.port,
      strictSSL: devServer.strictSSL,
      changeOrigin: devServer.changeOrigin,
      preStateBaseJavaScriptFiles: BUNDLED_ECODE_ASSETS.map((asset) => path.join(assetDirectory, asset.name)),
      logger: this.logger,
    };
  }

  private startFileWatching(projectRoot: string): void {
    this.stopFileWatching();
    const sourceWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(projectRoot, 'src/**/*'));
    const metadataWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(projectRoot, '.ecode/{ecode-tree.json,apps/*.json}')
    );
    const scheduleSource = (uri: vscode.Uri): void => {
      this.pendingSourceFiles.add(uri.fsPath);
      this.scheduleWatchFlush();
    };
    const scheduleMetadata = (): void => {
      this.metadataChanged = true;
      this.scheduleWatchFlush();
    };
    sourceWatcher.onDidCreate(scheduleSource);
    sourceWatcher.onDidChange(scheduleSource);
    sourceWatcher.onDidDelete(scheduleSource);
    metadataWatcher.onDidCreate(scheduleMetadata);
    metadataWatcher.onDidChange(scheduleMetadata);
    metadataWatcher.onDidDelete(scheduleMetadata);
    this.fileWatchers.push(sourceWatcher, metadataWatcher);
    this.logger.info('VS Code eCode file watchers started.');
  }

  private stopFileWatching(): void {
    if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
    this.watchDebounceTimer = undefined;
    this.pendingSourceFiles.clear();
    this.metadataChanged = false;
    this.fileWatchers.splice(0).forEach((watcher) => watcher.dispose());
  }

  private scheduleWatchFlush(): void {
    if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
    this.watchDebounceTimer = setTimeout(() => {
      this.watchDebounceTimer = undefined;
      void this.flushWatchChanges();
    }, 80);
  }

  private async flushWatchChanges(): Promise<void> {
    const runtime = this.runtime;
    if (!runtime) return;
    const metadataChanged = this.metadataChanged;
    const files = [...this.pendingSourceFiles];
    this.metadataChanged = false;
    this.pendingSourceFiles.clear();
    try {
      if (metadataChanged) await runtime.reloadConfiguration();
      else await runtime.rebuildFiles(files);
    } catch (error) {
      this.logger.error('Automatic local eCode rebuild failed.', error);
      this.output.show(true);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue
      .catch(() => undefined)
      .then(async () => {
        await vscode.commands.executeCommand('setContext', 'ecode.dev.busy', true);
        try {
          return await operation();
        } catch (error) {
          this.logger.error('eCode development operation failed.', error);
          this.output.show(true);
          throw error;
        } finally {
          await vscode.commands.executeCommand('setContext', 'ecode.dev.busy', false);
        }
      });
    this.operationQueue = run;
    return run;
  }
}

export function showEcodeDevError(action: string, error: unknown): void {
  vscode.window.showErrorMessage(`${action} failed: ${getErrorMessage(error)}`);
}
