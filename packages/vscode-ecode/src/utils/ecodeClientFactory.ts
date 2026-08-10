import * as vscode from 'vscode';
import { EcodeClient, EcodeLogger } from 'ecode-sdk';
import { getActiveEcodeEnvironment, getEnvironmentCookieFile } from '../config/ecodeEnvironment';

export function createActiveEcodeClient(
  storageRoot: string,
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('ecode')
): EcodeClient {
  const environment = getActiveEcodeEnvironment(config);
  if (!environment) throw new Error('No eCode environment configured.');

  return new EcodeClient({
    baseUrl: environment.baseUrl,
    username: environment.username,
    password: environment.password,
    cookieFile: getEnvironmentCookieFile(storageRoot, environment),
    logger: new EcodeLogger({ console: true, level: 'debug' }),
  });
}

export class ActiveEcodeClientProvider {
  private client: EcodeClient | undefined;
  private environmentKey = '';

  constructor(private readonly storageRoot: string) {}

  get(config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('ecode')): EcodeClient {
    const environment = getActiveEcodeEnvironment(config);
    if (!environment) throw new Error('No eCode environment configured.');
    const environmentKey = JSON.stringify([
      environment.name,
      environment.baseUrl,
      environment.username,
      environment.password,
      environment.localDir,
    ]);
    if (!this.client || this.environmentKey !== environmentKey) {
      this.client = createActiveEcodeClient(this.storageRoot, config);
      this.environmentKey = environmentKey;
    }
    return this.client;
  }

  clear(): void {
    this.client = undefined;
    this.environmentKey = '';
  }
}
