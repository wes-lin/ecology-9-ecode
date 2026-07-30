import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { transform } from '@babel/standalone';

export type EcodeJavaScriptCompileOptions = {
  filename?: string;
  sourceType?: 'script' | 'module' | 'unambiguous';
  comments?: boolean;
  compact?: boolean | 'auto';
  minified?: boolean;
  retainLines?: boolean;
};

export type EcodeJavaScriptFileCompileOptions = EcodeJavaScriptCompileOptions;

/**
 * Compile browser-side eCode JavaScript and JSX with the legacy eCode Babel
 * toolchain.
 */
export function compileJavaScript(source: string, options: EcodeJavaScriptCompileOptions = {}): string {
  if (typeof source !== 'string') {
    throw new TypeError('JavaScript source must be a string.');
  }

  const result = transform(source, {
    filename: options.filename,
    sourceType: options.sourceType ?? 'module',
    comments: options.comments ?? true,
    compact: options.compact ?? false,
    minified: options.minified ?? false,
    retainLines: options.retainLines ?? false,
    sourceMaps: false,
    plugins: [
      ['proposal-decorators', { legacy: true }],
      ['proposal-class-properties', { loose: true }],
      'transform-instanceof',
    ],
    presets: ['es2015', 'react'],
  });

  if (typeof result.code !== 'string') {
    throw new Error('Babel did not produce JavaScript output.');
  }
  return result.code;
}

/**
 * Read and compile a JavaScript file without writing an output file.
 */
export async function compileJavaScriptFile(
  inputPath: string,
  options: EcodeJavaScriptFileCompileOptions = {}
): Promise<string> {
  const resolvedInput = path.resolve(inputPath);
  const source = await fs.readFile(resolvedInput, 'utf8');
  return compileJavaScript(source, {
    ...options,
    filename: options.filename ?? resolvedInput,
  });
}
