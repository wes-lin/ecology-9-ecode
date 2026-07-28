export function normalizeRemotePath(remotePath: string): string {
  return remotePath.replace(/\\/g, '/').replace(/^\/+/, '');
}
