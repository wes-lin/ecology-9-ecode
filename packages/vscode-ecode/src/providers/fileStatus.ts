import * as fs from 'node:fs';
import { promisify } from 'node:util';
import type { EcodeClient } from 'ecode-sdk';
import type { EcodeFileSyncStatus } from './ecodeNode';

const readFile = promisify(fs.readFile);

export type EcodeFileStatusResult = {
  localPath: string;
  remoteText: string;
  status: EcodeFileSyncStatus;
};

function toText(content: string | Buffer): string {
  return Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
}

export async function getEcodeFileStatus(
  client: EcodeClient,
  localPath: string,
  remoteFileId: string
): Promise<EcodeFileStatusResult> {
  const localExists = fs.existsSync(localPath);
  const remoteText = toText(await client.viewFile(remoteFileId));

  if (!localExists) {
    return { localPath, remoteText, status: 'untracked' };
  }

  const localText = await readFile(localPath, 'utf8');
  return {
    localPath,
    remoteText,
    status: localText === remoteText ? 'clean' : 'modified',
  };
}
