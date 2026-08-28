import type * as vscode from 'vscode';

export type RawEcodeDevServerConfig = {
  host?: unknown;
  port?: unknown;
  autoOpen?: unknown;
  openPath?: unknown;
  strictSSL?: unknown;
  changeOrigin?: unknown;
};

export type EcodeDevServerConfig = {
  host: string;
  port: number;
  autoOpen: boolean;
  openPath: string;
  strictSSL: boolean;
  changeOrigin: boolean;
};

export const DEFAULT_ECODE_DEV_SERVER: EcodeDevServerConfig = {
  host: '127.0.0.1',
  port: 9090,
  autoOpen: true,
  openPath: '/',
  strictSSL: true,
  changeOrigin: true,
};

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function portValue(value: unknown): number {
  const port = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_ECODE_DEV_SERVER.port;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeEcodeDevServer(value: unknown): EcodeDevServerConfig {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as RawEcodeDevServerConfig) : {};
  return {
    host: stringValue(raw.host, DEFAULT_ECODE_DEV_SERVER.host),
    port: portValue(raw.port),
    autoOpen: booleanValue(raw.autoOpen, DEFAULT_ECODE_DEV_SERVER.autoOpen),
    openPath: stringValue(raw.openPath, DEFAULT_ECODE_DEV_SERVER.openPath),
    strictSSL: booleanValue(raw.strictSSL, DEFAULT_ECODE_DEV_SERVER.strictSSL),
    changeOrigin: booleanValue(raw.changeOrigin, DEFAULT_ECODE_DEV_SERVER.changeOrigin),
  };
}

export function getEcodeDevServer(config: vscode.WorkspaceConfiguration): EcodeDevServerConfig {
  return normalizeEcodeDevServer(config.get<RawEcodeDevServerConfig>('devServer'));
}
