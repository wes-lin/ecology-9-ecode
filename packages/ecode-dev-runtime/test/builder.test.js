const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { EcodeProjectBuilder } = require('../dist');

function write(root, relativePath, contents) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-dev-builder-'));
  const appId = '0123456789abcdef0123456789abcdef';
  const appPath = 'Business/Sample';
  const config = {
    path: appPath,
    appId,
    appStatus: 'released',
    appPreStateOrder: 10,
    preStateFiles: ['pre.js', 'pre.css'],
    resources: ['assets/logo.txt'],
    configs: ['config.js'],
    debugMode: 'n',
  };
  write(root, '.ecode/apps/app.json', `${JSON.stringify(config, null, 2)}\n`);
  write(
    root,
    '.ecode/ecode-tree.json',
    JSON.stringify([
      {
        id: appId,
        initialAppId: appId,
        name: 'Sample',
        children: [
          { id: 'consumer', name: 'consumer.js' },
          { id: 'provider', name: 'provider.js' },
          { id: 'style', name: 'style.css' },
        ],
      },
    ])
  );
  write(root, `src/${appPath}/consumer.js`, 'ecodeSDK.imp("service"); window.consumerLoaded = true;');
  write(root, `src/${appPath}/provider.js`, 'ecodeSDK.exp("service"); window.providerLoaded = "${appId}";');
  write(root, `src/${appPath}/config.js`, 'throw new Error("config files must not be compiled");');
  write(root, `src/${appPath}/style.css`, '.sample { color: red; }');
  write(root, `src/${appPath}/pre.js`, 'window.preStateApp = "${appId}";');
  write(root, `src/${appPath}/pre.css`, '.pre-state { display: block; }');
  write(root, `src/${appPath}/assets/logo.txt`, 'local-resource');
  return { root, appId, appPath, config };
}

describe('EcodeProjectBuilder', () => {
  it('builds app JavaScript, CSS, resources, and pre-state files', async () => {
    const project = createProject();
    try {
      const builder = new EcodeProjectBuilder({ projectRoot: project.root });
      const result = await builder.build();
      assert.deepEqual(result.builtAppIds, [project.appId]);

      const releaseRoot = path.join(project.root, 'dist', 'release', project.appId);
      const javascript = fs.readFileSync(path.join(releaseRoot, 'index.js'), 'utf8');
      assert.ok(javascript.indexOf('providerLoaded') < javascript.indexOf('consumerLoaded'));
      assert.match(javascript, new RegExp(project.appId));
      assert.doesNotMatch(javascript, /config files must not be compiled/);
      assert.match(javascript, /路径：/);

      const css = fs.readFileSync(path.join(releaseRoot, 'index.css'), 'utf8');
      assert.match(css, /sample/);
      assert.match(css, /pre-state/);
      assert.equal(fs.readFileSync(path.join(releaseRoot, 'assets', 'logo.txt'), 'utf8'), 'local-resource');

      const initJavaScript = fs.readFileSync(path.join(project.root, 'dist', 'dev', 'init.js'), 'utf8');
      assert.match(initJavaScript, /window\.ecodeSDK/);
      assert.match(initJavaScript, /window\.weaJs/);
      assert.match(initJavaScript, new RegExp(project.appId));
      const initCss = fs.readFileSync(path.join(project.root, 'dist', 'dev', 'init.css'), 'utf8');
      assert.match(initCss, /pre-state/);
    } finally {
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  });

  it('rebuilds the owning app and preserves unrelated dist output', async () => {
    const project = createProject();
    try {
      const builder = new EcodeProjectBuilder({
        projectRoot: project.root,
        preStateBaseJavaScriptFiles: [],
      });
      await builder.build();
      write(project.root, 'dist/app-upgrade/package.zip', 'preserve-me');
      const cssPath = write(project.root, `src/${project.appPath}/style.css`, '.sample { color: blue; }');
      const result = await builder.rebuildFile(cssPath);

      assert.deepEqual(result.builtAppIds, [project.appId]);
      assert.match(
        fs.readFileSync(path.join(project.root, 'dist', 'release', project.appId, 'index.css'), 'utf8'),
        /blue/
      );
      assert.equal(fs.readFileSync(path.join(project.root, 'dist/app-upgrade/package.zip'), 'utf8'), 'preserve-me');
    } finally {
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  });

  it('removes stale release output after an app becomes unreleased', async () => {
    const project = createProject();
    try {
      const builder = new EcodeProjectBuilder({
        projectRoot: project.root,
        preStateBaseJavaScriptFiles: [],
      });
      await builder.build();
      project.config.appStatus = '';
      write(project.root, '.ecode/apps/app.json', `${JSON.stringify(project.config, null, 2)}\n`);
      const result = await builder.reloadConfiguration();

      assert.deepEqual(result.builtAppIds, []);
      assert.equal(fs.existsSync(path.join(project.root, 'dist', 'release', project.appId)), false);
    } finally {
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  });
});
