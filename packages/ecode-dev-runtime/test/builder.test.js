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

  it('rebuilds CSS without compiling or replacing application JavaScript', async () => {
    const project = createProject();
    try {
      const builder = new EcodeProjectBuilder({ projectRoot: project.root });
      await builder.build();
      const outputJavaScript = path.join(project.root, 'dist', 'release', project.appId, 'index.js');
      const originalJavaScript = fs.readFileSync(outputJavaScript, 'utf8');
      write(project.root, `src/${project.appPath}/provider.js`, 'const broken = ;');
      const cssPath = write(project.root, `src/${project.appPath}/style.css`, '.sample { color: purple; }');

      const result = await builder.rebuildFile(cssPath);

      assert.deepEqual(result.builtAppIds, [project.appId]);
      assert.equal(fs.readFileSync(outputJavaScript, 'utf8'), originalJavaScript);
      assert.match(
        fs.readFileSync(path.join(project.root, 'dist', 'release', project.appId, 'index.css'), 'utf8'),
        /purple/
      );
    } finally {
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  });

  it('rebuilds JavaScript without replacing CSS or resources', async () => {
    const project = createProject();
    try {
      const builder = new EcodeProjectBuilder({ projectRoot: project.root });
      await builder.build();
      const outputCss = path.join(project.root, 'dist', 'release', project.appId, 'index.css');
      const originalCss = fs.readFileSync(outputCss, 'utf8');
      write(project.root, `src/${project.appPath}/style.css`, '.sample { color: orange; }');
      write(project.root, `src/${project.appPath}/assets/logo.txt`, 'not-copied-yet');
      const javaScriptPath = write(
        project.root,
        `src/${project.appPath}/provider.js`,
        'ecodeSDK.exp("service"); window.providerLoaded = "updated";'
      );

      const result = await builder.rebuildFile(javaScriptPath);

      assert.deepEqual(result.builtAppIds, [project.appId]);
      assert.match(
        fs.readFileSync(path.join(project.root, 'dist', 'release', project.appId, 'index.js'), 'utf8'),
        /updated/
      );
      assert.equal(fs.readFileSync(outputCss, 'utf8'), originalCss);
      assert.equal(
        fs.readFileSync(path.join(project.root, 'dist', 'release', project.appId, 'assets', 'logo.txt'), 'utf8'),
        'local-resource'
      );
    } finally {
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  });

  it('rebuilds a resource without compiling application JavaScript', async () => {
    const project = createProject();
    try {
      const builder = new EcodeProjectBuilder({ projectRoot: project.root });
      await builder.build();
      write(project.root, `src/${project.appPath}/provider.js`, 'const broken = ;');
      const resourcePath = write(project.root, `src/${project.appPath}/assets/logo.txt`, 'updated-resource');

      const result = await builder.rebuildFile(resourcePath);

      assert.deepEqual(result.builtAppIds, [project.appId]);
      assert.equal(
        fs.readFileSync(path.join(project.root, 'dist', 'release', project.appId, 'assets', 'logo.txt'), 'utf8'),
        'updated-resource'
      );
    } finally {
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  });

  it('rebuilds pre-state JavaScript without compiling application JavaScript', async () => {
    const project = createProject();
    try {
      const builder = new EcodeProjectBuilder({ projectRoot: project.root });
      await builder.build();
      const outputJavaScript = path.join(project.root, 'dist', 'release', project.appId, 'index.js');
      const originalJavaScript = fs.readFileSync(outputJavaScript, 'utf8');
      write(project.root, `src/${project.appPath}/provider.js`, 'const broken = ;');
      const preStatePath = write(
        project.root,
        `src/${project.appPath}/pre.js`,
        'window.preStateApp = "updated-pre-state";'
      );

      const result = await builder.rebuildFile(preStatePath);

      assert.deepEqual(result.builtAppIds, [project.appId]);
      assert.equal(fs.readFileSync(outputJavaScript, 'utf8'), originalJavaScript);
      assert.match(fs.readFileSync(path.join(project.root, 'dist', 'dev', 'init.js'), 'utf8'), /updated-pre-state/);
    } finally {
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  });

  it('only recompiles the changed pre-state JavaScript file', async () => {
    const project = createProject();
    try {
      project.config.preStateFiles.splice(1, 0, 'pre-other.js');
      write(project.root, '.ecode/apps/app.json', `${JSON.stringify(project.config, null, 2)}\n`);
      write(project.root, `src/${project.appPath}/pre-other.js`, 'window.otherPreState = "cached";');
      const builder = new EcodeProjectBuilder({
        projectRoot: project.root,
        preStateBaseJavaScriptFiles: [],
      });
      await builder.build();

      write(project.root, `src/${project.appPath}/pre-other.js`, 'const broken = ;');
      const changedPath = write(project.root, `src/${project.appPath}/pre.js`, 'window.preStateApp = "incremental";');
      const result = await builder.rebuildFile(changedPath);

      assert.deepEqual(result.builtAppIds, [project.appId]);
      const initJavaScript = fs.readFileSync(path.join(project.root, 'dist', 'dev', 'init.js'), 'utf8');
      assert.match(initJavaScript, /incremental/);
      assert.match(initJavaScript, /otherPreState = "cached"/);
      assert.doesNotMatch(initJavaScript, /const broken/);
    } finally {
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  });

  it('only refreshes the changed pre-state CSS fragment', async () => {
    const project = createProject();
    try {
      project.config.preStateFiles.push('pre-other.css');
      write(project.root, '.ecode/apps/app.json', `${JSON.stringify(project.config, null, 2)}\n`);
      write(project.root, `src/${project.appPath}/pre-other.css`, '.other-pre-state { color: green; }');
      const builder = new EcodeProjectBuilder({
        projectRoot: project.root,
        preStateBaseJavaScriptFiles: [],
      });
      await builder.build();

      write(project.root, `src/${project.appPath}/pre-other.css`, '.other-pre-state { color: orange; }');
      const changedPath = write(project.root, `src/${project.appPath}/pre.css`, '.pre-state { display: flex; }');
      const result = await builder.rebuildFile(changedPath);

      assert.deepEqual(result.builtAppIds, [project.appId]);
      const initCss = fs.readFileSync(path.join(project.root, 'dist', 'dev', 'init.css'), 'utf8');
      assert.match(initCss, /display: flex/);
      assert.match(initCss, /color: green/);
      assert.doesNotMatch(initCss, /color: orange/);
    } finally {
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  });

  it('updates multiple changed pre-state fragments in one batch', async () => {
    const project = createProject();
    try {
      project.config.preStateFiles.splice(1, 0, 'pre-other.js');
      project.config.preStateFiles.push('pre-other.css');
      write(project.root, '.ecode/apps/app.json', `${JSON.stringify(project.config, null, 2)}\n`);
      write(project.root, `src/${project.appPath}/pre-other.js`, 'window.otherPreState = "initial";');
      write(project.root, `src/${project.appPath}/pre-other.css`, '.other-pre-state { color: green; }');
      const builder = new EcodeProjectBuilder({
        projectRoot: project.root,
        preStateBaseJavaScriptFiles: [],
      });
      await builder.build();

      const changedFiles = [
        write(project.root, `src/${project.appPath}/pre.js`, 'window.preStateApp = "batch-first";'),
        write(project.root, `src/${project.appPath}/pre-other.js`, 'window.otherPreState = "batch-second";'),
        write(project.root, `src/${project.appPath}/pre.css`, '.pre-state { display: grid; }'),
        write(project.root, `src/${project.appPath}/pre-other.css`, '.other-pre-state { color: purple; }'),
      ];
      const result = await builder.rebuildFiles(changedFiles);

      assert.deepEqual(result.builtAppIds, [project.appId]);
      const initJavaScript = fs.readFileSync(path.join(project.root, 'dist', 'dev', 'init.js'), 'utf8');
      assert.match(initJavaScript, /batch-first/);
      assert.match(initJavaScript, /batch-second/);
      const initCss = fs.readFileSync(path.join(project.root, 'dist', 'dev', 'init.css'), 'utf8');
      assert.match(initCss, /display: grid/);
      assert.match(initCss, /color: purple/);
    } finally {
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  });

  it('rebuilds JavaScript, CSS, and resources from one change batch', async () => {
    const project = createProject();
    try {
      const messages = [];
      const builder = new EcodeProjectBuilder({
        projectRoot: project.root,
        preStateBaseJavaScriptFiles: [],
        logger: {
          debug: () => {},
          info: (message) => messages.push(message),
          warn: () => {},
          error: () => {},
        },
      });
      await builder.build();
      assert.ok(messages.some((message) => message.includes('[1/1] Building eCode app')));
      assert.ok(messages.some((message) => message.includes('Building global eCode pre-state output')));
      messages.length = 0;

      const changedFiles = [
        write(
          project.root,
          `src/${project.appPath}/provider.js`,
          'ecodeSDK.exp("service"); window.providerLoaded = "batch-js";'
        ),
        write(project.root, `src/${project.appPath}/consumer.js`, 'window.consumerLoaded = "batch-consumer";'),
        write(project.root, `src/${project.appPath}/style.css`, '.sample { color: teal; }'),
        write(project.root, `src/${project.appPath}/assets/logo.txt`, 'batch-resource'),
      ];
      const result = await builder.rebuildFiles(changedFiles);

      assert.deepEqual(result.builtAppIds, [project.appId]);
      const releaseRoot = path.join(project.root, 'dist', 'release', project.appId);
      assert.match(fs.readFileSync(path.join(releaseRoot, 'index.js'), 'utf8'), /batch-js/);
      assert.match(fs.readFileSync(path.join(releaseRoot, 'index.js'), 'utf8'), /batch-consumer/);
      assert.match(fs.readFileSync(path.join(releaseRoot, 'index.css'), 'utf8'), /teal/);
      assert.equal(fs.readFileSync(path.join(releaseRoot, 'assets', 'logo.txt'), 'utf8'), 'batch-resource');
      assert.ok(messages.some((message) => message.includes('3 parallel task(s)')));
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
