export function normalizeNewlines(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

export function normalizeRemotePath(remotePath: string): string {
  return remotePath.replace(/\\/g, '/').replace(/^\/+/, '');
}
