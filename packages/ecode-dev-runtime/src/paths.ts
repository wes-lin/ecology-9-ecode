import * as path from 'node:path';

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function normalizeRelativePath(value: string): string {
  return toPosixPath(value).replace(/^\/+|\/+$/g, '');
}

export function normalizePathKey(value: string): string {
  const normalized = normalizeRelativePath(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function resolveInside(root: string, relativePath: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its root: ${relativePath}`);
  }
  return resolvedPath;
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
