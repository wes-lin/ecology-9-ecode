import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { compileJavaScript, type EcodeAppConfig } from 'ecode-sdk';
import { normalizePathKey, toPosixPath } from '../paths';
import { listFiles } from './file-utils';
import { appendSourceComment, applyAppId, removeUseStrict, wrapJavaScript } from './javascript-utils';

type SourceFile = {
  absolutePath: string;
  relativePath: string;
  source: string;
  treeOrder?: number;
  importModules: string[];
  exportModules: string[];
};

function parseModuleNames(contents: string, methodName: 'imp' | 'exp'): string[] {
  const names: string[] = [];
  const source = contents.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const pattern = new RegExp(`ecodeSDK\\.${methodName}\\(\\s*([A-Za-z_$][\\w$]*|["']([^"']+)["'])\\s*\\)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) names.push(match[2] || match[1]);
  return names;
}

function compareByTreeOrder(left: SourceFile, right: SourceFile): number {
  const leftHasOrder = Number.isInteger(left.treeOrder);
  const rightHasOrder = Number.isInteger(right.treeOrder);
  if (leftHasOrder && rightHasOrder && left.treeOrder !== right.treeOrder) {
    return (left.treeOrder as number) - (right.treeOrder as number);
  }
  if (leftHasOrder) return -1;
  if (rightHasOrder) return 1;
  return left.relativePath.localeCompare(right.relativePath);
}

function sortDependentModules(files: SourceFile[]): SourceFile[] {
  const sorted: SourceFile[] = [];
  const remaining = files.slice();
  while (remaining.length > 0) {
    const selectedIndex = remaining.findIndex(
      (candidate, candidateIndex) =>
        !remaining.some(
          (pending, pendingIndex) =>
            pendingIndex !== candidateIndex &&
            pending.exportModules.some((name) => candidate.importModules.includes(name))
        )
    );
    if (selectedIndex < 0) throw new Error('eCode JavaScript modules contain a circular dependency.');
    sorted.push(remaining.splice(selectedIndex, 1)[0]);
  }
  return sorted;
}

function sortJavaScriptFiles(files: SourceFile[]): SourceFile[] {
  const onlyExports: SourceFile[] = [];
  const ordinary: SourceFile[] = [];
  const dependentExports: SourceFile[] = [];
  const onlyImports: SourceFile[] = [];

  files.sort(compareByTreeOrder);
  for (const file of files) {
    if (file.importModules.length === 0 && file.exportModules.length > 0) onlyExports.push(file);
    else if (file.importModules.length === 0 && file.exportModules.length === 0) ordinary.push(file);
    else if (file.importModules.length > 0 && file.exportModules.length > 0) dependentExports.push(file);
    else onlyImports.push(file);
  }
  return onlyExports.concat(ordinary, sortDependentModules(dependentExports), onlyImports);
}

export async function buildAppJavaScript(
  app: EcodeAppConfig,
  sourceRoot: string,
  outputRoot: string,
  treeOrders: Map<string, number>
): Promise<void> {
  await fs.mkdir(outputRoot, { recursive: true });
  const files = await listFiles(sourceRoot);
  const relativePath = (filePath: string): string => toPosixPath(path.relative(sourceRoot, filePath));
  const preStateFiles = new Set(app.preStateFiles.map(normalizePathKey));
  const resourceFiles = new Set(app.resources.map(normalizePathKey));
  const configFiles = new Set(app.configs.map(normalizePathKey));
  const javaScriptFiles: SourceFile[] = [];

  for (const filePath of files) {
    const relative = relativePath(filePath);
    const key = normalizePathKey(relative);
    if (!/\.(js|jsx)$/i.test(relative) || preStateFiles.has(key) || resourceFiles.has(key) || configFiles.has(key)) {
      continue;
    }
    const source = await fs.readFile(filePath, 'utf8');
    javaScriptFiles.push({
      absolutePath: filePath,
      relativePath: relative,
      source,
      treeOrder: treeOrders.get(key),
      importModules: parseModuleNames(source, 'imp'),
      exportModules: parseModuleNames(source, 'exp'),
    });
  }

  const compiledJavaScript = sortJavaScriptFiles(javaScriptFiles)
    .map((file) => {
      const compiled = removeUseStrict(
        compileJavaScript(applyAppId(file.source, app.appId), { filename: file.absolutePath })
      );
      return appendSourceComment(compiled, `${app.path}/${file.relativePath}`);
    })
    .join('');
  const outputPath = path.join(outputRoot, 'index.js');
  if (javaScriptFiles.length > 0) await fs.writeFile(outputPath, wrapJavaScript(compiledJavaScript), 'utf8');
  else await fs.rm(outputPath, { force: true });
}
