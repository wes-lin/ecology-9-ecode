import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 * Read, compile, and write a JavaScript file synchronously.
 */
export function compileJavaScriptFile(
  inputPath: string,
  outputPath: string,
  options: EcodeJavaScriptFileCompileOptions = {}
): string {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);
  if (resolvedInput === resolvedOutput) {
    throw new Error('JavaScript compiler output must not overwrite the source file.');
  }

  const source = readFileSync(resolvedInput, 'utf8');
  const compiled = compileJavaScript(source, {
    ...options,
    filename: options.filename ?? resolvedInput,
  });
  mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, compiled, 'utf8');
  return compiled;
}
