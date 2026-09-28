const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

function loadTypeScript(relativePath) {
  const bundle = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', relativePath)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    write: false,
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
    (name) => name === 'vscode' ? {} : require(name), module, module.exports
  );
  return module.exports;
}

describe('root type creation', () => {
  it('marks newly created local apps as eligible for reset', () => {
    const { createLocalAppTree } = loadTypeScript('src/providers/local/createAppTree.ts');
    assert.equal(createLocalAppTree('New App').localOnly, true);
  });

  it('adds a local top-level type to the source directory and tree', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-root-type-'));
    try {
      const treePath = path.join(projectRoot, '.ecode', 'ecode-tree.json');
      fs.mkdirSync(path.dirname(treePath), { recursive: true });
      fs.writeFileSync(treePath, '[]\n');
      const { LocalEcodeTreeStore } = loadTypeScript('src/providers/local/treeStore.ts');
      const store = new LocalEcodeTreeStore({ activeEnvironmentRoot: projectRoot });
      const item = { id: 'type-1', name: 'TopLevel', treeType: 'folder', businessType: 'type', localOnly: true };

      await store.createRootFolderAndNode(item, 'TopLevel');

      assert.ok(fs.statSync(path.join(projectRoot, 'src', 'TopLevel')).isDirectory());
      assert.deepEqual(JSON.parse(fs.readFileSync(treePath, 'utf8')), [item]);
      await assert.rejects(store.createRootFolderAndNode(item, 'TopLevel'), /already exists/);
      assert.equal(JSON.parse(fs.readFileSync(treePath, 'utf8')).length, 1);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('sends an empty remote parent ID at the root and the type ID for nested types', async () => {
    const calls = [];
    const { RemoteEcodeOperations } = loadTypeScript('src/providers/remote/operations.ts');
    const operations = new RemoteEcodeOperations({ get: () => ({ addType: async (...args) => calls.push(args) }) });

    await operations.createType(undefined, 'TopLevel');
    await operations.createType({ id: 'parent-type' }, 'Nested');

    assert.deepEqual(calls, [['TopLevel', ''], ['Nested', 'parent-type']]);
  });

  it('resets a linked app to unassociated without deleting its files', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-reset-association-'));
    try {
      const treePath = path.join(projectRoot, '.ecode', 'ecode-tree.json');
      const sourceFile = path.join(projectRoot, 'src', 'Type', 'Manual', 'index.js');
      fs.mkdirSync(path.dirname(treePath), { recursive: true });
      fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
      fs.writeFileSync(sourceFile, 'const value = 1;');
      fs.writeFileSync(treePath, JSON.stringify([{ id: 'type-1', name: 'Type', treeType: 'folder', businessType: 'type', children: [
        { id: 'app-1', name: 'Manual', treeType: 'folder', initialAppId: 'app-1', localOnly: true, children: [
          { id: 'file-1', name: 'index.js', treeType: 'file' },
        ] },
      ] }]));
      const { LocalEcodeTreeStore } = loadTypeScript('src/providers/local/treeStore.ts');
      const store = new LocalEcodeTreeStore({ activeEnvironmentRoot: projectRoot });
      await store.synchronize();
      const appConfig = path.join(projectRoot, '.ecode', 'apps', 'app-1.json');
      assert.ok(fs.existsSync(appConfig));

      await store.resetAssociation('app-1', 'Type/Manual');

      assert.equal(fs.readFileSync(sourceFile, 'utf8'), 'const value = 1;');
      assert.equal(fs.existsSync(appConfig), false);
      assert.deepEqual(JSON.parse(fs.readFileSync(treePath, 'utf8'))[0].children, []);
      assert.deepEqual(
        (await store.findUnassociatedLocalItems(await store.readRequired())).map((item) => item.relativePath),
        ['Type/Manual']
      );

      await store.associateLocalItem('Type/Manual', 'type');
      const relinked = JSON.parse(fs.readFileSync(treePath, 'utf8'))[0].children[0];
      assert.equal(relinked.businessType, 'type');
      assert.equal(relinked.localOnly, true);
      assert.notEqual(relinked.id, 'app-1');
      assert.equal(fs.readFileSync(sourceFile, 'utf8'), 'const value = 1;');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('can reset a type and link the same folder as an app', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-relink-type-'));
    try {
      const treePath = path.join(projectRoot, '.ecode', 'ecode-tree.json');
      const sourceFile = path.join(projectRoot, 'src', 'Type', 'Manual', 'index.js');
      fs.mkdirSync(path.dirname(treePath), { recursive: true });
      fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
      fs.writeFileSync(sourceFile, 'const value = 2;');
      fs.writeFileSync(treePath, JSON.stringify([{ id: 'type-1', name: 'Type', treeType: 'folder', businessType: 'type', children: [
        { id: 'wrong-type', name: 'Manual', treeType: 'folder', businessType: 'type', localOnly: true, children: [] },
      ] }]));
      const { LocalEcodeTreeStore } = loadTypeScript('src/providers/local/treeStore.ts');
      const store = new LocalEcodeTreeStore({ activeEnvironmentRoot: projectRoot });

      await store.resetAssociation('wrong-type', 'Type/Manual');
      await store.associateLocalItem('Type/Manual', 'app');

      const relinked = JSON.parse(fs.readFileSync(treePath, 'utf8'))[0].children[0];
      assert.equal(relinked.initialAppId, relinked.id);
      assert.equal(relinked.localOnly, true);
      assert.notEqual(relinked.id, 'wrong-type');
      assert.equal(relinked.children[0].name, 'index.js');
      assert.equal(fs.readFileSync(sourceFile, 'utf8'), 'const value = 2;');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('refuses to reset an existing downloaded app', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-existing-app-'));
    try {
      const treePath = path.join(projectRoot, '.ecode', 'ecode-tree.json');
      const sourceFile = path.join(projectRoot, 'src', 'Type', 'Existing', 'index.js');
      fs.mkdirSync(path.dirname(treePath), { recursive: true });
      fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
      fs.writeFileSync(sourceFile, 'const original = true;');
      const tree = [{ id: 'type-1', name: 'Type', treeType: 'folder', businessType: 'type', children: [
        { id: 'old-app', name: 'Existing', treeType: 'folder', initialAppId: 'old-app', children: [] },
      ] }];
      fs.writeFileSync(treePath, JSON.stringify(tree));
      const { LocalEcodeTreeStore } = loadTypeScript('src/providers/local/treeStore.ts');
      const store = new LocalEcodeTreeStore({ activeEnvironmentRoot: projectRoot });

      await assert.rejects(store.resetAssociation('old-app', 'Type/Existing'), /Only locally created/);

      assert.deepEqual(JSON.parse(fs.readFileSync(treePath, 'utf8')), tree);
      assert.equal(fs.readFileSync(sourceFile, 'utf8'), 'const original = true;');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
