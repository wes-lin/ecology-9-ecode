export type EcodeDevLogger = {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
};

export const NOOP_DEV_LOGGER: EcodeDevLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export type EcodeDevBuildOptions = {
  projectRoot: string;
  outputDirectory?: string;
  appsDirectory?: string;
  treeFile?: string;
  /**
   * JavaScript files prepended to dist/dev/init.js. When omitted, the runtime
   * uses its bundled ecode-sdk.js and wea.js assets. Pass an empty array to
   * disable the bundled files explicitly.
   */
  preStateBaseJavaScriptFiles?: string[];
  logger?: EcodeDevLogger;
};

export type EcodeDevBuildResult = {
  builtAppIds: string[];
  outputDirectory: string;
  durationMs: number;
};

export type EcodeDevProxyOptions = {
  projectRoot: string;
  target: string;
  outputDirectory?: string;
  host?: string;
  port?: number;
  changeOrigin?: boolean;
  strictSSL?: boolean;
  rewriteCookies?: boolean;
  rewriteRedirects?: boolean;
  logger?: EcodeDevLogger;
};

export type EcodeDevServerAddress = {
  host: string;
  port: number;
  url: string;
};

export type EcodeDevRuntimeOptions = EcodeDevBuildOptions & {
  proxyTarget?: string;
  host?: string;
  port?: number;
  changeOrigin?: boolean;
  strictSSL?: boolean;
  rewriteCookies?: boolean;
  rewriteRedirects?: boolean;
  watchDebounceMs?: number;
};
