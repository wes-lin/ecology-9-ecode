import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeNewlines, normalizeRemotePath } from '../utils/pathUtils';

export type SnapshotEntry = {
  remotePath: string;
  localPath: string;
  contentHash: string;
  updatedAt: string;
};

type SnapshotFile = {
  version: 1;
  files: Record<string, SnapshotEntry>;
};

export function hashContent(content: string | Buffer): string {
  const normalized = Buffer.isBuffer(content) ? content : normalizeNewlines(content);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export class SnapshotStore {
  private readonly getSnapshotFile: () => string;
  private loaded = false;
  private dirty = false;
  private data: SnapshotFile = { version: 1, files: {} };

  constructor(getSnapshotFile: () => string) {
    this.getSnapshotFile = getSnapshotFile;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const snapshotFile = this.getSnapshotFile();
      if (!fs.existsSync(snapshotFile)) return;
      const raw = await fs.promises.readFile(snapshotFile, 'utf8');
      const parsed = JSON.parse(raw) as SnapshotFile;
      if (parsed.version === 1 && parsed.files && typeof parsed.files === 'object') {
        this.data = parsed;
      }
    } catch {
      this.data = { version: 1, files: {} };
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    const snapshotFile = this.getSnapshotFile();
    await fs.promises.mkdir(path.dirname(snapshotFile), { recursive: true });
    await fs.promises.writeFile(snapshotFile, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    this.dirty = false;
  }

  get(remotePath: string): SnapshotEntry | undefined {
    return this.data.files[normalizeRemotePath(remotePath)];
  }

  set(entry: SnapshotEntry): void {
    const remotePath = normalizeRemotePath(entry.remotePath);
    const next = { ...entry, remotePath };
    const current = this.data.files[remotePath];
    if (current?.localPath === next.localPath && current.contentHash === next.contentHash) {
      return;
    }
    this.data.files[remotePath] = next;
    this.dirty = true;
  }

  delete(remotePath: string): void {
    const normalized = normalizeRemotePath(remotePath);
    if (!(normalized in this.data.files)) return;
    delete this.data.files[normalized];
    this.dirty = true;
  }

  list(): SnapshotEntry[] {
    return Object.values(this.data.files);
  }
}
