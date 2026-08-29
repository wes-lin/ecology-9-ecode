import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { EcodeAppConfig } from 'ecode-sdk';
import { normalizePathKey, resolveInside } from '../paths';
import { fileExists } from './file-utils';

export async function copyAppResources(app: EcodeAppConfig, sourceRoot: string, outputRoot: string): Promise<void> {
  for (const resource of app.resources) {
    const sourcePath = resolveInside(sourceRoot, resource, 'eCode resource path');
    if (!(await fileExists(sourcePath))) continue;
    const destinationPath = resolveInside(outputRoot, resource, 'eCode resource output path');
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }
}

export async function rebuildResource(
  app: EcodeAppConfig,
  sourceRoot: string,
  outputRoot: string,
  relativePath: string
): Promise<void> {
  const resource = app.resources.find((candidate) => normalizePathKey(candidate) === relativePath);
  if (!resource) return;
  const sourcePath = resolveInside(sourceRoot, resource, 'eCode resource path');
  const destinationPath = resolveInside(outputRoot, resource, 'eCode resource output path');
  if (await fileExists(sourcePath)) {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  } else {
    await fs.rm(destinationPath, { force: true });
  }
}
