const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { collectEcodeAppConfigs } = require('../../ecode-sdk/dist/index.js');

const bundle = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '../src/providers/local/associateLocalItems.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const localModule = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, localModule, localModule.exports);
const { associateLocalItems, findUnassociatedLocalItems } = localModule.exports;

function write(root, relativePath) {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '');
}

describe('local item association', () => {
  it('asks whether type children are apps or types and adds existing app files once', async () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-associate-'));
    const tree = [
      {
        id: 'type-1',
        name: 'Type',
        treeType: 'type',
        businessType: 'type',
        children: [{ id: 'existing-app', name: 'Existing', treeType: 'folder', initialAppId: 'existing-app', children: [] }],
      },
    ];
    try {
      for (const name of [
        'Type/Existing/new.js',
        'Type/Manual/config/config.js',
        'Type/Manual/resources/logo.png',
        'Type/Manual/src/index.js',
        'Type/Nested/Child/index.js',
      ]) write(sourceRoot, name);

      const choices = [];
      const choose = async (relativePath) => {
        choices.push(relativePath);
        return relativePath === 'Type/Nested' ? 'type' : 'app';
      };
      const first = await associateLocalItems(sourceRoot, tree, choose);
      assert.deepEqual(first, { apps: 2, types: 1, folders: 3, files: 5, skipped: 0 });
      assert.deepEqual(choices, ['Type/Manual', 'Type/Nested', 'Type/Nested/Child']);

      const manual = tree[0].children.find((node) => node.name === 'Manual');
      assert.match(manual.id, /^[a-f0-9]{32}$/);
      assert.equal(manual.initialAppId, manual.id);
      assert.equal(manual.localOnly, true);
      const config = collectEcodeAppConfigs(tree).find((app) => app.appId === manual.id);
      assert.deepEqual(config.preStateFiles, ['config/config.js']);
      assert.deepEqual(config.resources, ['resources/logo.png']);
      assert.deepEqual(config.configs, ['config/config.js']);
      assert.equal(tree[0].children.find((node) => node.name === 'Nested').businessType, 'type');
      assert.equal(tree[0].children.find((node) => node.name === 'Nested').localOnly, true);

      const second = await associateLocalItems(sourceRoot, tree, choose);
      assert.deepEqual(second, { apps: 0, types: 0, folders: 0, files: 0, skipped: 0 });
      assert.equal(choices.length, 3);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('leaves an ambiguous directory unassociated when selection is dismissed', async () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-associate-skip-'));
    const tree = [{ id: 'type-1', name: 'Type', treeType: 'type', businessType: 'type', children: [] }];
    try {
      write(sourceRoot, 'Type/Unknown/index.js');
      const result = await associateLocalItems(sourceRoot, tree, async () => undefined);
      assert.deepEqual(result, { apps: 0, types: 0, folders: 0, files: 0, skipped: 1 });
      assert.deepEqual(tree[0].children, []);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('links only the clicked type and shows its children for separate selection', async () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-associate-click-'));
    const tree = [{ id: 'type-1', name: 'Type', treeType: 'type', businessType: 'type', children: [] }];
    try {
      write(sourceRoot, 'Type/Nested/Child/index.js');
      assert.deepEqual(
        (await findUnassociatedLocalItems(sourceRoot, tree)).map((item) => item.relativePath),
        ['Type/Nested']
      );

      const typeResult = await associateLocalItems(sourceRoot, tree, async () => 'type', 'Type/Nested');
      assert.equal(typeResult.types, 1);
      assert.equal(typeResult.apps, 0);
      assert.deepEqual(
        (await findUnassociatedLocalItems(sourceRoot, tree)).map((item) => item.relativePath),
        ['Type/Nested/Child']
      );

      const appResult = await associateLocalItems(sourceRoot, tree, async () => 'app', 'Type/Nested/Child');
      assert.equal(appResult.apps, 1);
      assert.equal(appResult.files, 1);
      assert.deepEqual(await findUnassociatedLocalItems(sourceRoot, tree), []);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});
