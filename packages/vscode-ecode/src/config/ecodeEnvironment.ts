import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';

export type RawEcodeEnvironmentConfig = {
  name?: unknown;
  baseUrl?: unknown;
  username?: unknown;
  password?: unknown;
  localDir?: unknown;
};

export type EcodeEnvironmentConfig = {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  localDir: string;
};

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getEcodeEnvironments(config: vscode.WorkspaceConfiguration): EcodeEnvironmentConfig[] {
  const rawEnvironments = config.get<RawEcodeEnvironmentConfig[]>('environments', []);
  if (!Array.isArray(rawEnvironments)) return [];

  return rawEnvironments
    .map((environment) => ({
      name: toStringValue(environment.name),
      baseUrl: toStringValue(environment.baseUrl),
      username: toStringValue(environment.username),
      password: toStringValue(environment.password),
      localDir: toStringValue(environment.localDir) || './',
    }))
    .filter((environment) => environment.name);
}

export function getActiveEcodeEnvironment(config: vscode.WorkspaceConfiguration): EcodeEnvironmentConfig | undefined {
  const environments = getEcodeEnvironments(config);
  const activeName = config.get('activeEnvironment', '');
  return environments.find((environment) => environment.name === activeName) ?? environments[0];
}

export function getActiveEcodeEnvironmentRoot(config: vscode.WorkspaceConfiguration): string {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) throw new Error('No workspace folder open.');

  const environment = getActiveEcodeEnvironment(config);
  if (!environment) throw new Error('No eCode environment configured.');

  return path.resolve(workspaceRoot, environment.localDir);
}

export function getEcodeEnvironmentError(environment: EcodeEnvironmentConfig | undefined): string | undefined {
  if (!environment) return 'No eCode environment configured.';
  if (!environment.baseUrl || environment.baseUrl === 'http://localhost') {
    return `Environment "${environment.name}" is missing baseUrl.`;
  }
  if (!environment.username) return `Environment "${environment.name}" is missing username.`;
  if (!environment.password) return `Environment "${environment.name}" is missing password.`;
  if (!environment.localDir) return `Environment "${environment.name}" is missing localDir.`;
  return undefined;
}

export function normalizeEnvironmentBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function getEnvironmentCookieFile(storageRoot: string, environment: EcodeEnvironmentConfig): string {
  const safeName = environment.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'environment';
  const hash = crypto
    .createHash('sha256')
    .update(`${environment.name}\n${normalizeEnvironmentBaseUrl(environment.baseUrl)}\n${environment.username}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(storageRoot, 'cookies', `${safeName}-${hash}.json`);
}
