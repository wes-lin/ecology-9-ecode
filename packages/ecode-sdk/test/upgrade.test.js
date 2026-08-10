const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { buildAppUpgradePackage, collectEcodeAppConfigs } = require('../dist');
const { listZipEntries, readZipEntry } = require('./zip');

const APP_ID = '11111111111111111111111111111111';
const SECOND_APP_ID = '33333333333333333333333333333333';
const TYPE_ID = '22222222222222222222222222222222';

function getUpgradeOutputDirectory(projectRoot) {
  return path.join(projectRoot, 'output');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function findMetadataNode(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const descendant = findMetadataNode(node.children, id);
    if (descendant) return descendant;
  }
  return undefined;
}

function createFixture({ appStatus = 'released' } = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-upgrade-sdk-'));
  const appPath = path.join(projectRoot, 'src', '分类', '应用');
  const tree = [
    {
      id: TYPE_ID,
      name: '分类',
      businessType: 'type',
      children: [
        {
          id: APP_ID,
          initialAppId: APP_ID,
          name: '应用',
          treeType: 'folder',
          status: 'released',
          debugMode: 'n',
          children: [
            { id: 'file-index', name: 'index.js', treeType: 'file' },
            {
              id: 'folder-config',
              name: 'config',
              treeType: 'folder',
              attribute: 'config',
              children: [
                { id: 'file-config-js', name: 'config.js', treeType: 'file', attribute: 'config' },
                { id: 'file-config-json', name: 'config.json', treeType: 'file', attribute: 'non-code' },
              ],
            },
            {
              id: 'folder-resources',
              name: 'resources',
              treeType: 'folder',
              attribute: 'resource',
              children: [{ id: 'resource-logo', name: 'logo.png', treeType: 'resource' }],
            },
            { id: 'folder-jar', name: 'jar', treeType: 'folder', attribute: 'jar', children: [] },
          ],
        },
      ],
    },
  ];

  fs.mkdirSync(path.join(appPath, 'config'), { recursive: true });
  fs.mkdirSync(path.join(appPath, 'resources'), { recursive: true });
  fs.mkdirSync(path.join(appPath, 'jar'), { recursive: true });
  fs.writeFileSync(path.join(appPath, 'index.js'), 'const view = <div>Hello</div>;\n', 'utf8');
  fs.writeFileSync(path.join(appPath, 'config', 'config.js'), 'const config = {};\n', 'utf8');
  fs.writeFileSync(path.join(appPath, 'config', 'config.json'), '{"enabled":true}\n', 'utf8');
  fs.writeFileSync(path.join(appPath, 'resources', 'logo.png'), Buffer.from([1, 2, 3, 4]));
  writeJson(path.join(projectRoot, '.ecode', 'apps', `${APP_ID}.json`), {
    path: '分类/应用',
    appId: APP_ID,
    appStatus,
    appPreStateOrder: 10000,
    preStateFiles: [],
    resources: ['resources/logo.png'],
    configs: ['config/config.js', 'config/config.json'],
    debugMode: 'n',
  });
  writeJson(path.join(projectRoot, '.ecode', 'ecode-tree.json'), tree);
  return projectRoot;
}

function addSecondFixtureApp(projectRoot) {
  const appPath = path.join(projectRoot, 'src', '分类', '应用二');
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(path.join(appPath, 'index.js'), 'const view = <span>Second</span>;\n', 'utf8');
  writeJson(path.join(projectRoot, '.ecode', 'apps', `${SECOND_APP_ID}.json`), {
    path: '分类/应用二',
    appId: SECOND_APP_ID,
    appStatus: 'released',
    appPreStateOrder: 10000,
    preStateFiles: [],
    resources: [],
    configs: [],
    debugMode: 'n',
  });

  const treePath = path.join(projectRoot, '.ecode', 'ecode-tree.json');
  const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));
  tree[0].children.push({
    id: SECOND_APP_ID,
    initialAppId: SECOND_APP_ID,
    name: '应用二',
    treeType: 'folder',
    status: 'released',
    debugMode: 'n',
    children: [{ id: 'second-file-index', name: 'index.js', treeType: 'file' }],
  });
  writeJson(treePath, tree);
}

describe('eCode upgrade package builder', () => {
  it('preserves appStatus in exported app metadata', async () => {
    const projectRoot = createFixture({ appStatus: 'draft' });

    try {
      const result = await buildAppUpgradePackage({
        projectRoot,
        apps: [APP_ID],
        outputDirectory: getUpgradeOutputDirectory(projectRoot),
      });
      const packageId = path.basename(result.archivePath, '.zip');
      const ecode = JSON.parse(readZipEntry(result.archivePath, `${packageId}/ecode.json`).toString('utf8'));
      assert.equal(findMetadataNode(ecode.datas, APP_ID).status, 'draft');
      assert.equal(result.plan.apps[0].appStatus, 'draft');
      assert.equal(
        listZipEntries(result.archivePath).some((entry) => entry.endsWith('/config.json')),
        false
      );
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('builds one reference-compatible batch archive for multiple apps', async () => {
    const projectRoot = createFixture();
    addSecondFixtureApp(projectRoot);

    try {
      const outputDirectory = getUpgradeOutputDirectory(projectRoot);
      const existingOutput = path.join(outputDirectory, 'existing.txt');
      fs.mkdirSync(path.dirname(existingOutput), { recursive: true });
      fs.writeFileSync(existingOutput, 'keep');
      const appResult = await buildAppUpgradePackage({
        projectRoot,
        apps: [APP_ID, SECOND_APP_ID],
        outputDirectory,
      });
      assert.equal(fs.existsSync(existingOutput), true);
      const packageId = path.basename(appResult.archivePath, '.zip');
      assert.match(packageId, /^\d{13}[0-9a-f]{32}$/);
      assert.equal(appResult.plan.apps.length, 2);
      const packageEntries = listZipEntries(appResult.archivePath);
      assert.ok(packageEntries.includes(`${packageId}/ecode.json`));
      assert.ok(packageEntries.includes(`${packageId}/${APP_ID}/index.js`));
      assert.ok(packageEntries.includes(`${packageId}/${SECOND_APP_ID}/index.js`));
      assert.equal(packageEntries.includes(`${packageId}/${APP_ID}/${APP_ID}/`), false);
      assert.equal(
        packageEntries.some((entry) => entry.endsWith('/config.json')),
        false
      );
      assert.equal(
        packageEntries.some((entry) => entry.endsWith('/pinyin.json')),
        false
      );
      assert.equal(
        packageEntries.some((entry) => entry.endsWith('.zip')),
        false
      );
      assert.equal(
        readZipEntry(appResult.archivePath, `${packageId}/${APP_ID}/index.js`).toString('utf8'),
        'const view = <div>Hello</div>;\r\n'
      );

      const ecode = JSON.parse(readZipEntry(appResult.archivePath, `${packageId}/ecode.json`).toString('utf8'));
      assert.equal(ecode.datas.length, 1);
      assert.equal(ecode.datas[0].id, TYPE_ID);
      assert.deepEqual(ecode.datas[0].children.map((node) => node.id).sort(), [APP_ID, SECOND_APP_ID].sort());
      const firstAppMetadata = findMetadataNode(ecode.datas, APP_ID);
      assert.equal(firstAppMetadata.keepAppIdFlag, false);
      assert.equal(firstAppMetadata.rootFolderFlag, false);
      assert.equal(firstAppMetadata.encoded, false);
      assert.equal(firstAppMetadata.confParams.config_id, 'file-config-js');
      assert.equal(firstAppMetadata.confParams.configJson_id, 'file-config-json');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('accepts in-memory app metadata without reading .ecode/apps', async () => {
    const projectRoot = createFixture();

    try {
      const treePath = path.join(projectRoot, '.ecode', 'ecode-tree.json');
      const appConfigs = collectEcodeAppConfigs(JSON.parse(fs.readFileSync(treePath, 'utf8')));
      fs.rmSync(path.join(projectRoot, '.ecode', 'apps'), { recursive: true, force: true });

      const result = await buildAppUpgradePackage({
        projectRoot,
        apps: [APP_ID],
        appConfigs,
        outputDirectory: getUpgradeOutputDirectory(projectRoot),
      });
      assert.equal(result.plan.apps[0].appId, APP_ID);
      assert.ok(fs.existsSync(result.archivePath));
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects unsafe in-memory app metadata', async () => {
    const projectRoot = createFixture();

    try {
      const treePath = path.join(projectRoot, '.ecode', 'ecode-tree.json');
      const [appConfig] = collectEcodeAppConfigs(JSON.parse(fs.readFileSync(treePath, 'utf8')));

      await assert.rejects(
        buildAppUpgradePackage({
          projectRoot,
          apps: [APP_ID],
          appConfigs: [{ ...appConfig, path: '../outside' }],
          outputDirectory: getUpgradeOutputDirectory(projectRoot),
        }),
        /contains an unsafe path/
      );
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects invalid app ids through the package builder', async () => {
    const projectRoot = createFixture();

    try {
      const treePath = path.join(projectRoot, '.ecode', 'ecode-tree.json');
      const [appConfig] = collectEcodeAppConfigs(JSON.parse(fs.readFileSync(treePath, 'utf8')));

      await assert.rejects(
        buildAppUpgradePackage({
          projectRoot,
          apps: ['invalid'],
          appConfigs: [{ ...appConfig, appId: 'invalid' }],
          outputDirectory: getUpgradeOutputDirectory(projectRoot),
        }),
        /Invalid app id/
      );
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('requires callers to provide the output directory', async () => {
    const projectRoot = createFixture();

    try {
      await assert.rejects(buildAppUpgradePackage({ projectRoot, apps: [APP_ID] }), /output directory is required/);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
