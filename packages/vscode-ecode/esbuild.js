const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

fs.rmSync('dist', { recursive: true, force: true });

const workspaceAliasPlugin = {
  name: 'workspace-alias',
  setup(build) {
    build.onResolve({ filter: /^ecode-sdk$/ }, () => ({
      path: path.resolve(__dirname, '../ecode-sdk/src/index.ts'),
    }));
  },
};

const options = {
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

async function main() {
  if (watch) {
    const context = await esbuild.context(options);
    await context.watch();
    console.log('Watching VS Code extension sources...');
    return;
  }

  await esbuild.build(options);
}

main().catch(() => process.exit(1));
