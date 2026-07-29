import * as path from 'node:path';

export function normalizeTreePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function getSafeRelativeTreePath(value: string, pathLabel = 'eCode tree path'): string {
  const normalized = path.normalize(normalizeTreePath(String(value || '')));
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized === '..' ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Invalid ${pathLabel}: ${value}`);
  }
  return normalized;
}

export function resolveTreePath(rootPath: string, treePath: string, pathLabel = 'eCode tree path'): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, getSafeRelativeTreePath(treePath, pathLabel));
  const relative = path.relative(root, target);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Invalid ${pathLabel}: ${treePath}`);
  }
  return target;
}
