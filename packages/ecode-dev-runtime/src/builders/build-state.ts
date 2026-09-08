import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { normalizePathKey, toPosixPath } from '../paths';
import type { EcodePreStateCache } from './prestate';
import { fileExists, listFiles } from './file-utils';

const BUILD_STATE_VERSION = 2;

type FileSnapshotEntry = {
  path: string;
  signature: string;
};

export type FileSnapshot = Record<string, FileSnapshotEntry>;

export type EcodeBuildState = {
  version: number;
  metadata: FileSnapshot;
  sources: FileSnapshot;
  outputs: FileSnapshot;
  preState: EcodePreStateCache;
};

type BuildStateStoreOptions = {
  projectRoot: string;
  sourceDirectory: string;
  appsDirectory: string;
  treeFile: string;
  outputDirectory: string;
  baseJavaScriptFiles: string[];
};

function snapshotsEqual(left: FileSnapshot, right: FileSnapshot): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key]?.signature === right[key]?.signature && left[key]?.path === right[key]?.path)
  );
}

export class EcodeBuildStateStore {
  readonly stateFile: string;
  private readonly projectRoot: string;
  private readonly sourceDirectory: string;
  private readonly appsDirectory: string;
  private readonly treeFile: string;
  private readonly outputDirectory: string;
  private readonly baseJavaScriptFiles: string[];

  constructor(options: BuildStateStoreOptions) {
    this.projectRoot = options.projectRoot;
    this.sourceDirectory = options.sourceDirectory;
    this.appsDirectory = options.appsDirectory;
    this.treeFile = options.treeFile;
    this.outputDirectory = options.outputDirectory;
    this.baseJavaScriptFiles = options.baseJavaScriptFiles;
    this.stateFile = path.join(this.outputDirectory, '.ecode-dev-runtime', 'build-state.json');
  }

  async load(): Promise<EcodeBuildState | undefined> {
    try {
      const state: unknown = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (!this.isBuildState(state) || state.version !== BUILD_STATE_VERSION) return undefined;
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  async create(preState: EcodePreStateCache): Promise<EcodeBuildState> {
    return {
      version: BUILD_STATE_VERSION,
      metadata: await this.captureMetadata(),
      sources: await this.captureSources(),
      outputs: await this.captureOutputs(),
      preState,
    };
  }

  captureMetadata(): Promise<FileSnapshot> {
    return this.getMetadataFiles().then((filePaths) => this.captureFiles(filePaths, true));
  }

  async captureSources(): Promise<FileSnapshot> {
    return this.captureFiles(await listFiles(this.sourceDirectory));
  }

  async captureOutputs(): Promise<FileSnapshot> {
    const files = (
      await Promise.all([
        listFiles(path.join(this.outputDirectory, 'release')),
        listFiles(path.join(this.outputDirectory, 'dev')),
      ])
    ).flat();
    return this.captureFiles(files);
  }

  metadataMatches(state: EcodeBuildState, metadata: FileSnapshot): boolean {
    return snapshotsEqual(state.metadata, metadata);
  }

  async outputsMatch(state: EcodeBuildState): Promise<boolean> {
    return snapshotsEqual(state.outputs, await this.captureOutputs());
  }

  diffSources(state: EcodeBuildState, sources: FileSnapshot): string[] {
    const changedFiles: string[] = [];
    const keys = new Set([...Object.keys(state.sources), ...Object.keys(sources)]);
    for (const key of keys) {
      const previous = state.sources[key];
      const current = sources[key];
      if (previous?.signature === current?.signature && previous?.path === current?.path) continue;
      changedFiles.push(path.resolve(this.projectRoot, current?.path || previous.path));
    }
    return changedFiles;
  }

  async captureChangedSources(
    state: EcodeBuildState,
    filePaths: string[]
  ): Promise<{ filePaths: string[]; snapshot: FileSnapshot }> {
    const changedFiles: string[] = [];
    const snapshot: FileSnapshot = {};
    for (const filePath of filePaths) {
      if (!this.isSourceFile(filePath)) {
        changedFiles.push(filePath);
        continue;
      }
      const relativePath = toPosixPath(path.relative(this.projectRoot, filePath));
      const previous = state.sources[normalizePathKey(relativePath)];
      const signature = await this.readSignature(filePath);
      if (previous?.signature === signature && previous.path === relativePath) continue;
      if (!previous && signature === undefined) continue;
      changedFiles.push(filePath);
      if (signature !== undefined) snapshot[normalizePathKey(relativePath)] = { path: relativePath, signature };
    }
    return { filePaths: changedFiles, snapshot };
  }

  async updateSources(state: EcodeBuildState, filePaths: string[], snapshot?: FileSnapshot): Promise<void> {
    for (const filePath of filePaths) {
      if (!this.isSourceFile(filePath)) continue;
      const relativePath = toPosixPath(path.relative(this.projectRoot, filePath));
      const key = normalizePathKey(relativePath);
      if (snapshot) {
        const current = snapshot[key];
        if (current) state.sources[key] = current;
        else delete state.sources[key];
        continue;
      }
      const signature = await this.readSignature(filePath);
      if (signature === undefined) delete state.sources[key];
      else state.sources[key] = { path: relativePath, signature };
    }
  }

  async updateOutputs(state: EcodeBuildState): Promise<void> {
    state.outputs = await this.captureOutputs();
  }

  async save(state: EcodeBuildState): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.writeFile(this.stateFile, `${JSON.stringify(state)}\n`, 'utf8');
  }

  private async getMetadataFiles(): Promise<string[]> {
    const files = await listFiles(this.appsDirectory);
    if (await fileExists(this.treeFile)) files.push(this.treeFile);
    files.push(...this.baseJavaScriptFiles);
    return files;
  }

  private async captureFiles(filePaths: string[], contentHash = false): Promise<FileSnapshot> {
    const entries = await Promise.all(
      filePaths.map(async (filePath): Promise<[string, FileSnapshotEntry] | undefined> => {
        const signature = contentHash ? await this.readContentSignature(filePath) : await this.readSignature(filePath);
        if (signature === undefined) return undefined;
        const relativePath = this.toStatePath(filePath);
        return [normalizePathKey(relativePath), { path: relativePath, signature }];
      })
    );
    return Object.fromEntries(entries.filter((entry): entry is [string, FileSnapshotEntry] => entry !== undefined));
  }

  private async readSignature(filePath: string): Promise<string | undefined> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile() ? `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async readContentSignature(filePath: string): Promise<string | undefined> {
    try {
      return createHash('sha256')
        .update(await fs.readFile(filePath))
        .digest('hex');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private toStatePath(filePath: string): string {
    const relativePath = path.relative(this.projectRoot, filePath);
    return path.isAbsolute(relativePath) || relativePath.startsWith(`..${path.sep}`)
      ? toPosixPath(path.resolve(filePath))
      : toPosixPath(relativePath);
  }

  private isSourceFile(filePath: string): boolean {
    const relativePath = path.relative(this.sourceDirectory, filePath);
    return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
  }

  private isBuildState(value: unknown): value is EcodeBuildState {
    if (!value || typeof value !== 'object') return false;
    const state = value as Partial<EcodeBuildState>;
    return (
      typeof state.version === 'number' &&
      Boolean(state.metadata) &&
      Boolean(state.sources) &&
      Boolean(state.outputs) &&
      Boolean(state.preState)
    );
  }
}
