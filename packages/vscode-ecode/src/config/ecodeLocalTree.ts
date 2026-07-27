import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RemoteTreeItem } from 'ecode-sdk';

export type EcodeLocalTreeItem = RemoteTreeItem & {
  children?: EcodeLocalTreeItem[];
};

export async function readLocalTreeFile(targetPath: string): Promise<EcodeLocalTreeItem[] | undefined> {
  if (!fs.existsSync(targetPath)) return undefined;

  const parsed: unknown = JSON.parse(await fs.promises.readFile(targetPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid local eCode tree at ${targetPath}: expected a JSON array.`);
  }
  return parsed as EcodeLocalTreeItem[];
}

export async function writeLocalTreeFile(targetPath: string, items: EcodeLocalTreeItem[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}
