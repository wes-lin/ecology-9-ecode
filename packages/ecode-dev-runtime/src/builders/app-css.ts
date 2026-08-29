import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { EcodeAppConfig } from 'ecode-sdk';
import { normalizePathKey, toPosixPath } from '../paths';
import { listFiles } from './file-utils';

export async function buildAppCss(app: EcodeAppConfig, sourceRoot: string, outputRoot: string): Promise<void> {
  await fs.mkdir(outputRoot, { recursive: true });
  const files = await listFiles(sourceRoot);
  const relativePath = (filePath: string): string => toPosixPath(path.relative(sourceRoot, filePath));
  const resourceFiles = new Set(app.resources.map(normalizePathKey));
  const cssFiles = files
    .filter((filePath) => /\.css$/i.test(filePath) && !resourceFiles.has(normalizePathKey(relativePath(filePath))))
    .sort((left, right) => relativePath(left).localeCompare(relativePath(right)));
  const css = (await Promise.all(cssFiles.map((filePath) => fs.readFile(filePath, 'utf8')))).join('');
  await fs.writeFile(path.join(outputRoot, 'index.css'), css, 'utf8');
}
