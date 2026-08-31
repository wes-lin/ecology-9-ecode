import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { compileJavaScript, type EcodeAppConfig } from 'ecode-sdk';
import { normalizePathKey, resolveInside } from '../paths';
import { appendSourceComment, applyAppId, removeUseStrict, wrapJavaScript } from './javascript-utils';

type PreStateFile = {
  appId: string;
  sourcePath: string;
  commentPath: string;
};

type PreStateBuilderOptions = {
  sourceDirectory: string;
  outputDirectory: string;
  baseJavaScriptFiles: string[];
};

export type EcodePreStateCache = {
  version: 1;
  javaScriptParts: Record<string, string | null>;
  cssParts: Record<string, string | null>;
};

export class EcodePreStateBuilder {
  private readonly sourceDirectory: string;
  private readonly outputDirectory: string;
  private readonly baseJavaScriptFiles: string[];
  private cachedJavaScriptFiles?: PreStateFile[];
  private cachedCssFiles?: PreStateFile[];
  private cachedBaseJavaScript?: string;
  private readonly javaScriptParts = new Map<string, string>();
  private readonly cssParts = new Map<string, string>();
  private javaScriptCacheInitialized = false;
  private cssCacheInitialized = false;

  constructor(options: PreStateBuilderOptions) {
    this.sourceDirectory = options.sourceDirectory;
    this.outputDirectory = options.outputDirectory;
    this.baseJavaScriptFiles = options.baseJavaScriptFiles;
  }

  reset(): void {
    this.cachedJavaScriptFiles = undefined;
    this.cachedCssFiles = undefined;
    this.cachedBaseJavaScript = undefined;
    this.javaScriptParts.clear();
    this.cssParts.clear();
    this.javaScriptCacheInitialized = false;
    this.cssCacheInitialized = false;
  }

  createCache(): EcodePreStateCache | undefined {
    if (!this.javaScriptCacheInitialized || !this.cssCacheInitialized) return undefined;
    return {
      version: 1,
      javaScriptParts: this.createCachedParts(this.cachedJavaScriptFiles || [], this.javaScriptParts),
      cssParts: this.createCachedParts(this.cachedCssFiles || [], this.cssParts),
    };
  }

  restoreCache(apps: EcodeAppConfig[], cache: EcodePreStateCache): boolean {
    if (cache.version !== 1) return false;
    const javaScriptFiles = this.getJavaScriptFiles(apps);
    const cssFiles = this.getCssFiles(apps);
    if (!this.restoreCachedParts(javaScriptFiles, cache.javaScriptParts, this.javaScriptParts)) return false;
    if (!this.restoreCachedParts(cssFiles, cache.cssParts, this.cssParts)) return false;
    this.javaScriptCacheInitialized = true;
    this.cssCacheInitialized = true;
    return true;
  }

  async build(apps: EcodeAppConfig[]): Promise<void> {
    await this.buildJavaScript(apps);
    await this.buildCss(apps);
  }

  async buildJavaScript(apps: EcodeAppConfig[], changedFilePaths?: string[]): Promise<void> {
    const devOutput = path.join(this.outputDirectory, 'dev');
    await fs.mkdir(devOutput, { recursive: true });
    const files = this.getJavaScriptFiles(apps);

    if (!changedFilePaths || !this.javaScriptCacheInitialized) {
      this.javaScriptParts.clear();
      await Promise.all(files.map((file) => this.updateJavaScriptPart(file)));
      this.javaScriptCacheInitialized = true;
    } else {
      const changedFiles = this.findFiles(files, changedFilePaths);
      await Promise.all(changedFiles.map((file) => this.updateJavaScriptPart(file)));
    }

    const parts = this.collectParts(files, this.javaScriptParts);
    const outputPath = path.join(devOutput, 'init.js');
    if (parts.length === 0) {
      await fs.rm(outputPath, { force: true });
      return;
    }
    await fs.writeFile(outputPath, (await this.readBaseJavaScript()) + parts.join(''), 'utf8');
  }

  async buildCss(apps: EcodeAppConfig[], changedFilePaths?: string[]): Promise<void> {
    const devOutput = path.join(this.outputDirectory, 'dev');
    await fs.mkdir(devOutput, { recursive: true });
    const files = this.getCssFiles(apps);

    if (!changedFilePaths || !this.cssCacheInitialized) {
      this.cssParts.clear();
      await Promise.all(files.map((file) => this.updateCssPart(file)));
      this.cssCacheInitialized = true;
    } else {
      const changedFiles = this.findFiles(files, changedFilePaths);
      await Promise.all(changedFiles.map((file) => this.updateCssPart(file)));
    }

    const parts = this.collectParts(files, this.cssParts);
    const outputPath = path.join(devOutput, 'init.css');
    if (parts.length > 0) await fs.writeFile(outputPath, parts.join(''), 'utf8');
    else await fs.rm(outputPath, { force: true });
  }

  private getJavaScriptFiles(apps: EcodeAppConfig[]): PreStateFile[] {
    this.cachedJavaScriptFiles ||= this.createFiles(apps, /\.(js|jsx)$/i);
    return this.cachedJavaScriptFiles;
  }

  private getCssFiles(apps: EcodeAppConfig[]): PreStateFile[] {
    this.cachedCssFiles ||= this.createFiles(apps, /\.css$/i);
    return this.cachedCssFiles;
  }

  private createFiles(apps: EcodeAppConfig[], matcher: RegExp): PreStateFile[] {
    const files: PreStateFile[] = [];
    const orderedApps = apps
      .slice()
      .sort((left, right) => (left.appPreStateOrder || 0) - (right.appPreStateOrder || 0));

    for (const app of orderedApps) {
      const sourceRoot = resolveInside(this.sourceDirectory, app.path, 'eCode app path');
      for (const relativePath of app.preStateFiles) {
        if (!matcher.test(relativePath)) continue;
        files.push({
          appId: app.appId,
          sourcePath: resolveInside(sourceRoot, relativePath, 'eCode pre-state path'),
          commentPath: `${app.path}/${relativePath}(${app.appId})`,
        });
      }
    }
    return files;
  }

  private findFiles(files: PreStateFile[], changedFilePaths: string[]): PreStateFile[] {
    const changedKeys = new Set(changedFilePaths.map(normalizePathKey));
    return files.filter((file) => changedKeys.has(normalizePathKey(file.sourcePath)));
  }

  private collectParts(files: PreStateFile[], cache: Map<string, string>): string[] {
    return files
      .map((file) => cache.get(normalizePathKey(file.sourcePath)))
      .filter((part): part is string => part !== undefined);
  }

  private createCachedParts(files: PreStateFile[], parts: Map<string, string>): Record<string, string | null> {
    return Object.fromEntries(
      files.map((file) => {
        const key = normalizePathKey(file.sourcePath);
        return [key, parts.get(key) ?? null];
      })
    );
  }

  private restoreCachedParts(
    files: PreStateFile[],
    cachedParts: Record<string, string | null>,
    parts: Map<string, string>
  ): boolean {
    if (!cachedParts || typeof cachedParts !== 'object') return false;
    const entries = files.map((file) => {
      const key = normalizePathKey(file.sourcePath);
      return [key, Object.prototype.hasOwnProperty.call(cachedParts, key) ? cachedParts[key] : undefined] as const;
    });
    if (entries.some(([, part]) => part === undefined)) return false;
    parts.clear();
    for (const [key, part] of entries) {
      if (part !== null) parts.set(key, part as string);
    }
    return true;
  }

  private async updateJavaScriptPart(file: PreStateFile): Promise<void> {
    const source = await this.readOptionalFile(file.sourcePath);
    const cacheKey = normalizePathKey(file.sourcePath);
    if (source === undefined) {
      this.javaScriptParts.delete(cacheKey);
      return;
    }
    const compiled = removeUseStrict(compileJavaScript(applyAppId(source, file.appId), { filename: file.sourcePath }));
    this.javaScriptParts.set(cacheKey, wrapJavaScript(appendSourceComment(compiled, file.commentPath)));
  }

  private async updateCssPart(file: PreStateFile): Promise<void> {
    const source = await this.readOptionalFile(file.sourcePath);
    const cacheKey = normalizePathKey(file.sourcePath);
    if (source === undefined) this.cssParts.delete(cacheKey);
    else this.cssParts.set(cacheKey, appendSourceComment(source, file.commentPath));
  }

  private async readOptionalFile(filePath: string): Promise<string | undefined> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async readBaseJavaScript(): Promise<string> {
    if (this.cachedBaseJavaScript !== undefined) return this.cachedBaseJavaScript;
    const parts: string[] = [];
    for (const filePath of this.baseJavaScriptFiles) {
      try {
        parts.push(await fs.readFile(filePath, 'utf8'));
      } catch (error) {
        throw new Error(
          `Unable to read eCode pre-state base JavaScript "${filePath}": ${error instanceof Error ? error.message : error}`
        );
      }
    }
    this.cachedBaseJavaScript = parts.join('');
    return this.cachedBaseJavaScript;
  }
}
