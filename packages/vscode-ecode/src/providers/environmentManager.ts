import * as path from 'node:path';
import * as vscode from 'vscode';
import { DEFAULT_ECODE_DEV_SERVER, getEcodeDevServer, type EcodeDevServerConfig } from '../config/ecodeDevServer';
import { EcodeEnvironmentConfig, getEcodeEnvironments } from '../config/ecodeEnvironment';
import { getErrorMessage } from '../utils/errors';
import { createEnvironmentSettingsHtml } from '../webviews/environmentSettingsHtml';

type EnvironmentManagerMessage = {
  command?: unknown;
  environments?: unknown;
  devServer?: unknown;
  activeIndex?: unknown;
  index?: unknown;
  name?: unknown;
};

export class EcodeEnvironmentManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const settingsAssetRoot = vscode.Uri.joinPath(this.extensionUri, 'assets', 'settings');
    const panel = vscode.window.createWebviewPanel(
      'ecode.environmentManager',
      'eCode Settings',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [settingsAssetRoot],
      }
    );
    this.panel = panel;
    panel.webview.html = createEnvironmentSettingsHtml(panel.webview, this.extensionUri);

    panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );
    panel.webview.onDidReceiveMessage(
      (message: EnvironmentManagerMessage) => this.handleMessage(message),
      undefined,
      this.disposables
    );
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  private async handleMessage(message: EnvironmentManagerMessage): Promise<void> {
    switch (message.command) {
      case 'ready':
        await this.postState();
        break;
      case 'save':
        await this.save(message.environments, message.devServer, message.activeIndex);
        break;
      case 'browseLocalDir':
        await this.browseLocalDirectory(message.index);
        break;
      case 'confirmDelete':
        await this.confirmDelete(message.index, message.name);
        break;
      case 'confirmDiscard':
        await this.confirmDiscard();
        break;
    }
  }

  private async postState(): Promise<void> {
    if (!this.panel) return;
    const config = vscode.workspace.getConfiguration('ecode');
    const environments = getEcodeEnvironments(config);
    const devServer = getEcodeDevServer(config);
    const configuredActiveName = config.get<string>('activeEnvironment', '');
    const activeIndex = Math.max(
      0,
      environments.findIndex((environment) => environment.name === configuredActiveName)
    );
    await this.panel.webview.postMessage({ type: 'state', environments, devServer, activeIndex });
  }

  private async save(rawEnvironments: unknown, rawDevServer: unknown, rawActiveIndex: unknown): Promise<void> {
    try {
      const environments = this.validateEnvironments(rawEnvironments);
      const devServer = this.validateDevServer(rawDevServer);
      const activeIndex = typeof rawActiveIndex === 'number' ? rawActiveIndex : 0;
      const activeEnvironment = environments[activeIndex] ?? environments[0];
      const config = vscode.workspace.getConfiguration('ecode');
      const environmentTarget = this.getConfigurationTarget(config, 'environments');

      await config.update('environments', environments, environmentTarget);
      await config.update(
        'activeEnvironment',
        activeEnvironment?.name ?? '',
        this.getConfigurationTarget(config, 'activeEnvironment')
      );
      await config.update('devServer', devServer, environmentTarget);
      await this.panel?.webview.postMessage({
        type: 'saved',
        environments,
        devServer,
        activeIndex: activeEnvironment ? environments.indexOf(activeEnvironment) : 0,
      });
      vscode.window.showInformationMessage('eCode settings saved.');
    } catch (error) {
      const message = getErrorMessage(error);
      await this.panel?.webview.postMessage({ type: 'error', message });
      vscode.window.showErrorMessage(`Could not save eCode settings: ${message}`);
    }
  }

  private validateEnvironments(value: unknown): EcodeEnvironmentConfig[] {
    if (!Array.isArray(value)) throw new Error('Environment data must be a list.');

    const environments = value.map((item, index) => {
      if (!item || typeof item !== 'object') throw new Error(`Environment ${index + 1} is invalid.`);
      const record = item as Record<string, unknown>;
      const environment: EcodeEnvironmentConfig = {
        name: this.stringValue(record.name),
        baseUrl: this.stringValue(record.baseUrl).replace(/\/+$/, ''),
        username: this.stringValue(record.username),
        password: this.stringValue(record.password),
        localDir: this.stringValue(record.localDir) || './',
      };

      if (!environment.name) throw new Error(`Environment ${index + 1} needs a name.`);
      if (!environment.baseUrl) throw new Error(`Environment "${environment.name}" needs a server URL.`);
      let url: URL;
      try {
        url = new URL(environment.baseUrl);
      } catch {
        throw new Error(`Environment "${environment.name}" has an invalid server URL.`);
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Environment "${environment.name}" must use an HTTP or HTTPS server URL.`);
      }
      if (!environment.username) throw new Error(`Environment "${environment.name}" needs an account.`);
      if (!environment.password) throw new Error(`Environment "${environment.name}" needs a password.`);
      return environment;
    });

    const names = new Set<string>();
    for (const environment of environments) {
      const key = environment.name.toLowerCase();
      if (names.has(key)) throw new Error(`Environment name "${environment.name}" is duplicated.`);
      names.add(key);
    }
    return environments;
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private validateDevServer(value: unknown): EcodeDevServerConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Development server settings are invalid.');
    }
    const record = value as Record<string, unknown>;
    return {
      host: this.stringValue(record.host) || DEFAULT_ECODE_DEV_SERVER.host,
      port: this.portValue(record.port),
      autoOpen: this.booleanValue(record.autoOpen, DEFAULT_ECODE_DEV_SERVER.autoOpen),
      openPath: this.stringValue(record.openPath) || DEFAULT_ECODE_DEV_SERVER.openPath,
      strictSSL: this.booleanValue(record.strictSSL, DEFAULT_ECODE_DEV_SERVER.strictSSL),
      changeOrigin: this.booleanValue(record.changeOrigin, DEFAULT_ECODE_DEV_SERVER.changeOrigin),
    };
  }

  private portValue(value: unknown): number {
    if (value === undefined || value === null || value === '') return 9090;
    const port = typeof value === 'number' ? value : Number(this.stringValue(value));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Local debug port must be an integer between 1 and 65535.');
    }
    return port;
  }

  private booleanValue(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }

  private getConfigurationTarget(
    config: vscode.WorkspaceConfiguration,
    key: 'environments' | 'activeEnvironment'
  ): vscode.ConfigurationTarget {
    const inspection = config.inspect(key);
    if (inspection?.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder;
    if (inspection?.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace;
    if (inspection?.globalValue !== undefined) return vscode.ConfigurationTarget.Global;
    return vscode.ConfigurationTarget.Global;
  }

  private async browseLocalDirectory(rawIndex: unknown): Promise<void> {
    const index = typeof rawIndex === 'number' ? rawIndex : -1;
    if (index < 0) return;

    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use as local directory',
      title: 'Select the eCode local directory',
    });
    if (!selected?.[0] || !this.panel) return;

    const selectedPath = selected[0].fsPath;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    let localDir = selectedPath;
    if (workspaceFolder) {
      const relativePath = path.relative(workspaceFolder.uri.fsPath, selectedPath);
      if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) localDir = relativePath || '.';
    }
    await this.panel.webview.postMessage({ type: 'localDir', index, localDir });
  }

  private async confirmDelete(rawIndex: unknown, rawName: unknown): Promise<void> {
    const index = typeof rawIndex === 'number' ? rawIndex : -1;
    if (index < 0 || !this.panel) return;

    const name = this.stringValue(rawName) || 'this environment';
    const confirmation = await vscode.window.showWarningMessage(`Delete "${name}"?`, { modal: true }, 'Delete');
    if (confirmation === 'Delete') await this.panel.webview.postMessage({ type: 'deleteConfirmed', index });
  }

  private async confirmDiscard(): Promise<void> {
    if (!this.panel) return;

    const confirmation = await vscode.window.showWarningMessage(
      'Discard all unsaved changes?',
      { modal: true },
      'Discard'
    );
    if (confirmation === 'Discard') await this.panel.webview.postMessage({ type: 'discardConfirmed' });
  }
}
