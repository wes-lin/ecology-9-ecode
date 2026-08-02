const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EcodeClient } = require('../dist/index.js');

function createClient() {
  const client = new EcodeClient();
  client.listTree = async (folderId = '', typeId = '') => {
    if (!folderId && !typeId) {
      return [{ id: 'type-1', name: 'Type', treeType: 'type', businessType: 'type', hasChild: true }];
    }
    if (typeId === 'type-1') {
      return [{ id: 'app-1', name: 'App', treeType: 'folder', initialAppId: 'app-1', hasChild: true }];
    }
    if (folderId === 'app-1') {
      return [
        { id: 'file-1', name: 'index.js', treeType: 'file', fileExtension: 'js' },
        { id: 'resource-folder', name: 'resources', treeType: 'folder', attribute: 'resource', hasChild: true },
      ];
    }
    if (folderId === 'resource-folder') {
      return [
        {
          id: 'resource-1',
          name: 'logo.bin',
          treeType: 'resource',
          route: '/resource/logo.bin',
        },
      ];
    }
    return [];
  };
  client.viewFile = async () => 'const value = 1;\r\n';
  client.viewResource = async () => Buffer.from([0, 1, 2, 3]);
  return client;
}

describe('eCode downloader', () => {
  it('should download files and generate .ecode/ecode-tree.json', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-download-'));

    try {
      const result = await createClient().download(temporaryRoot);
      const treePath = path.join(temporaryRoot, '.ecode', 'ecode-tree.json');
      const sourcePath = path.join(temporaryRoot, 'src', 'Type', 'App');

      assert.strictEqual(result.downloaded, 2);
      assert.strictEqual(result.skipped, 0);
      assert.strictEqual(result.failed, 0);
      assert.strictEqual(fs.readFileSync(path.join(sourcePath, 'index.js'), 'utf8'), 'const value = 1;\n');
      assert.deepStrictEqual(
        fs.readFileSync(path.join(sourcePath, 'resources', 'logo.bin')),
        Buffer.from([0, 1, 2, 3])
      );

      const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));
      assert.strictEqual(tree[0].name, 'Type');
      assert.strictEqual(tree[0].children[0].name, 'App');
      assert.strictEqual(tree[0].children[0].children[1].children[0].name, 'logo.bin');
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('should let integrations merge the tree before selecting files', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-download-plan-'));
    let preparedBeforeTreeWrite = false;

    try {
      const result = await createClient().download(temporaryRoot, {
        prepareTree: async (tree) => {
          preparedBeforeTreeWrite = !fs.existsSync(path.join(temporaryRoot, '.ecode', 'ecode-tree.json'));
          assert.strictEqual(tree[0].children[0].children.length, 2);
          return { filePaths: ['Type/App/index.js'] };
        },
      });

      assert.strictEqual(preparedBeforeTreeWrite, true);
      assert.strictEqual(result.totalFiles, 1);
      assert.strictEqual(result.downloaded, 1);
      assert.strictEqual(fs.existsSync(path.join(temporaryRoot, 'src', 'Type', 'App', 'index.js')), true);
      assert.strictEqual(fs.existsSync(path.join(temporaryRoot, 'src', 'Type', 'App', 'resources', 'logo.bin')), false);

      fs.writeFileSync(path.join(temporaryRoot, 'src', 'Type', 'App', 'index.js'), 'local change', 'utf8');
      const second = await createClient().download(temporaryRoot, {
        prepareTree: () => ({ filePaths: ['Type/App/index.js'] }),
      });
      assert.strictEqual(second.downloaded, 0);
      assert.strictEqual(second.skipped, 1);
      assert.strictEqual(
        fs.readFileSync(path.join(temporaryRoot, 'src', 'Type', 'App', 'index.js'), 'utf8'),
        'local change'
      );
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('should overwrite an existing source file when requested', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-download-overwrite-'));
    const targetPath = path.join(temporaryRoot, 'src', 'Type', 'App', 'index.js');

    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, 'local change', 'utf8');

      const result = await createClient().download(temporaryRoot, {
        overwrite: true,
        prepareTree: () => ({ filePaths: ['Type/App/index.js'] }),
      });

      assert.strictEqual(result.downloaded, 1);
      assert.strictEqual(result.skipped, 0);
      assert.strictEqual(result.failed, 0);
      assert.strictEqual(fs.readFileSync(targetPath, 'utf8'), 'const value = 1;\n');
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
