const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

fs.rmSync('dist', { recursive: true, force: true });
fs.cpSync(
  path.resolve(__dirname, '../ecode-dev-runtime/assets/ecode'),
  path.resolve(__dirname, 'dist/runtime-assets/ecode'),
  {
    recursive: true,
  }
);

const workspaceAliasPlugin = {
  name: 'workspace-alias',
  setup(build) {
    build.onResolve({ filter: /^ecode-sdk$/ }, () => ({
      path: path.resolve(__dirname, '../ecode-sdk/src/index.ts'),
    }));
    build.onResolve({ filter: /^ecode-dev-runtime$/ }, () => ({
      path: path.resolve(__dirname, '../ecode-dev-runtime/src/index.ts'),
    }));
  },
};

const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  sourcesContent: false,
  logLevel: 'info',
  plugins: [workspaceAliasPlugin],
};

const webviewOptions = {
  entryPoints: ['src/webviews/settings/index.ts'],
  bundle: true,
  outfile: 'dist/webviews/settings.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome108',
  sourcemap: !production,
  minify: production,
  sourcesContent: false,
  logLevel: 'info',
};

async function main() {
  if (watch) {
    const contexts = await Promise.all([esbuild.context(extensionOptions), esbuild.context(webviewOptions)]);
    await Promise.all(contexts.map((context) => context.watch()));
    console.log('Watching VS Code extension sources...');
    return;
  }

  await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
}

main().catch(() => process.exit(1));
