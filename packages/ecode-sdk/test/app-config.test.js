const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { collectEcodeAppConfigs, synchronizeEcodeAppConfigs } = require('../dist/index.js');

function createTree() {
  return [
    {
      id: 'toolkit',
      name: '工具包',
      businessType: 'type',
      children: [
        {
          id: 'toolkit-management',
          name: '工具包管理',
          businessType: 'type',
          children: [
            {
              id: 'app-folder',
              name: 'pageInfoConfig',
              treeType: 'folder',
              initialAppId: '8013eb95bbab480f8cd68cf180c63a0e',
              status: 'released',
              preStateOrder: 1,
              debugMode: 'n',
              children: [
                {
                  id: 'config-folder',
                  name: 'config',
                  treeType: 'folder',
                  children: [
                    {
                      id: 'config-js',
                      name: 'config.js',
                      treeType: 'file',
                      state: 'pre-state',
                    },
                    {
                      id: 'config-json',
                      name: 'config.json',
                      treeType: 'file',
                      attribute: 'config',
                    },
                    {
                      id: 'z-pre-state',
                      name: 'z-pre-state.js',
                      treeType: 'file',
                      state: 'pre-state',
                    },
                    {
                      id: 'a-pre-state',
                      name: 'a-pre-state.js',
                      treeType: 'file',
                      state: 'pre-state',
                    },
                  ],
                },
                {
                  id: 'marketing-js',
                  name: 'marketing.js',
                  treeType: 'file',
                  state: 'pre-state',
                },
                {
                  id: 'logo',
                  name: 'logo.png',
                  treeType: 'resource',
                },
                {
                  id: 'z-resource',
                  name: 'z-resource.png',
                  treeType: 'resource',
                },
                {
                  id: 'a-resource',
                  name: 'a-resource.png',
                  treeType: 'resource',
                },
                {
                  id: 'z-config',
                  name: 'z-config.json',
                  treeType: 'file',
                  attribute: 'config',
                },
                {
                  id: 'a-config',
                  name: 'a-config.json',
                  treeType: 'file',
                  attribute: 'non-code',
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

describe('eCode app configs', () => {
  it('collects app metadata from ecode tree data', () => {
    assert.deepEqual(collectEcodeAppConfigs(createTree()), [
      {
        path: '工具包/工具包管理/pageInfoConfig',
        appId: 'app-folder',
        appStatus: 'released',
        appPreStateOrder: 1,
        preStateFiles: ['config/a-pre-state.js', 'config/config.js', 'config/z-pre-state.js', 'marketing.js'],
        resources: ['a-resource.png', 'logo.png', 'z-resource.png'],
        configs: ['a-config.json', 'config/config.json', 'z-config.json'],
        debugMode: 'n',
      },
    ]);
  });

  it('uses the node id as appId for normal and system apps', () => {
    const configs = collectEcodeAppConfigs([
      {
        id: 'normal-node-id',
        name: 'Normal',
        treeType: 'folder',
        initialAppId: 'legacy-app-id',
      },
      {
        id: 'system-node-id',
        name: 'System',
        treeType: 'folder',
        attribute: 'system',
      },
    ]);

    assert.deepEqual(
      configs.map(({ appId }) => appId),
      ['normal-node-id', 'system-node-id']
    );
  });

  it('writes node id JSON files and removes stale generated metadata', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-app-config-'));

    try {
      const metadataDirectory = path.join(root, '.ecode');
      const appsDirectory = path.join(metadataDirectory, 'apps');
      const treePath = path.join(metadataDirectory, 'ecode-tree.json');
      fs.mkdirSync(appsDirectory, { recursive: true });
      fs.writeFileSync(treePath, `${JSON.stringify(createTree(), null, 2)}\n`);
      fs.writeFileSync(path.join(appsDirectory, 'stale.json'), '{}\n');
      fs.writeFileSync(path.join(appsDirectory, '8013eb95bbab480f8cd68cf180c63a0e.json'), '{}\n');
      fs.writeFileSync(path.join(metadataDirectory, 'ecode-apps.json'), '[]\n');

      await synchronizeEcodeAppConfigs(treePath);

      const appPath = path.join(appsDirectory, 'app-folder.json');
      assert.deepEqual(JSON.parse(fs.readFileSync(appPath, 'utf8')), collectEcodeAppConfigs(createTree())[0]);
      assert.equal(fs.existsSync(path.join(appsDirectory, '8013eb95bbab480f8cd68cf180c63a0e.json')), false);
      assert.equal(fs.existsSync(path.join(appsDirectory, 'stale.json')), false);
      assert.equal(fs.existsSync(path.join(metadataDirectory, 'ecode-apps.json')), false);

      fs.rmSync(treePath);
      await synchronizeEcodeAppConfigs(treePath);
      assert.equal(fs.existsSync(appPath), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
