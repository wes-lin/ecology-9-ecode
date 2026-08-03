import { randomUUID } from 'node:crypto';

export const LOCAL_NODE_ID_PREFIX = 'local-';

export function createEcodeId(): string {
  return randomUUID().replace(/-/g, '');
}

export function createLocalNodeId(): string {
  return `${LOCAL_NODE_ID_PREFIX}${createEcodeId()}`;
}

export function isLocalNodeId(id: string): boolean {
  return id.startsWith(LOCAL_NODE_ID_PREFIX);
}
