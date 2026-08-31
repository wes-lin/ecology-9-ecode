import * as vscode from 'vscode';
import { getEcodeDevServer, type EcodeDevServerConfig } from './ecodeDevServer';
import {
  getActiveEcodeEnvironment,
  getActiveEcodeEnvironmentRoot,
  getEcodeEnvironmentError,
  getEcodeEnvironments,
  type EcodeEnvironmentConfig,
} from './ecodeEnvironment';

export type EcodeSettingsKey = 'environments' | 'activeEnvironment' | 'devServer';

export type EcodeSettingsSnapshot = {
  environments: EcodeEnvironmentConfig[];
  activeEnvironment: string;
  devServer: EcodeDevServerConfig;
};

/** Centralizes effective eCode settings and preserves each setting's existing VS Code scope. */
export class EcodeSettingsRepository {
  constructor(private readonly resource?: vscode.Uri) {}

  get configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('ecode', this.resource);
  }

  get environments(): EcodeEnvironmentConfig[] {
    return getEcodeEnvironments(this.configuration);
  }

  get activeEnvironment(): EcodeEnvironmentConfig | undefined {
    return getActiveEcodeEnvironment(this.configuration);
  }

  get activeEnvironmentName(): string {
    return this.configuration.get<string>('activeEnvironment', '');
  }

  get activeEnvironmentRoot(): string {
    return getActiveEcodeEnvironmentRoot(this.configuration);
  }

  get devServer(): EcodeDevServerConfig {
    return getEcodeDevServer(this.configuration);
  }

  get environmentError(): string | undefined {
    return getEcodeEnvironmentError(this.activeEnvironment);
  }

  getConfigurationTarget(key: EcodeSettingsKey): vscode.ConfigurationTarget {
    const inspection = this.configuration.inspect(key);
    if (inspection?.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder;
    if (inspection?.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace;
    if (inspection?.globalValue !== undefined) return vscode.ConfigurationTarget.Global;
    return vscode.ConfigurationTarget.Global;
  }

  async updateActiveEnvironment(name: string): Promise<void> {
    await this.configuration.update('activeEnvironment', name, this.getConfigurationTarget('activeEnvironment'));
  }

  async save(snapshot: EcodeSettingsSnapshot): Promise<void> {
    const targets = {
      environments: this.getConfigurationTarget('environments'),
      activeEnvironment: this.getConfigurationTarget('activeEnvironment'),
      devServer: this.getConfigurationTarget('devServer'),
    };
    const config = this.configuration;
    await config.update('environments', snapshot.environments, targets.environments);
    await config.update('activeEnvironment', snapshot.activeEnvironment, targets.activeEnvironment);
    await config.update('devServer', snapshot.devServer, targets.devServer);
  }
}
