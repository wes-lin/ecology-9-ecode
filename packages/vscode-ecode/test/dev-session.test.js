const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { buildSync } = require('esbuild');

const compiled = buildSync({
  entryPoints: [path.join(__dirname, '../src/dev/ecodeDevSessionManager.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['vscode', 'ecode-dev-runtime'],
}).outputFiles[0].text;

function setup() {
  const contexts = new Map();
  const notices = [];
  let created = 0;
  let proxyStarts = 0;
  let releasePrepare;
  let signalPrepare;
  const entered = new Promise((resolve) => {
    signalPrepare = resolve;
  });
  const runtime = {
    async prepare() {
      await new Promise((resolve, reject) => {
        releasePrepare = reject;
        signalPrepare();
      });
    },
    cancel() {
      releasePrepare?.(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    },
    async dispose() {
      this.cancel();
    },
    async startProxy() {
      proxyStarts += 1;
      return { url: 'http://localhost:9090', port: 9090 };
    },
  };
  const vscode = {
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
      createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
      showInformationMessage: (message) => notices.push(message),
    },
    commands: {
      async executeCommand(_command, key, value) {
        contexts.set(key, value);
      },
    },
    workspace: { isTrusted: true },
    StatusBarAlignment: { Left: 1 },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    Error,
    require(name) {
      if (name === 'vscode') return vscode;
      if (name === 'ecode-dev-runtime')
        return {
          BUNDLED_ECODE_ASSETS: [],
          createEcodeDevRuntime() {
            created += 1;
            return runtime;
          },
        };
      return require(name);
    },
  });
  const manager = new module.exports.EcodeDevSessionManager(
    { fsPath: __dirname },
    {
      activeEnvironment: { name: 'test', baseUrl: 'http://localhost' },
      activeEnvironmentRoot: __dirname,
      devServer: { host: 'localhost', port: 9090, autoOpen: false },
    }
  );
  return {
    manager,
    contexts,
    entered,
    notices,
    get created() {
      return created;
    },
    get proxyStarts() {
      return proxyStarts;
    },
  };
}

test('stop cancels startup preparation before waiting for the command queue', async () => {
  const state = setup();
  const starting = state.manager.start();
  await state.entered;
  assert.equal(state.contexts.get('ecode.dev.starting'), true);
  await Promise.all([starting, state.manager.stop()]);
  assert.equal(state.proxyStarts, 0);
  assert.equal(state.contexts.get('ecode.dev.starting'), false);
  assert.equal(state.contexts.get('ecode.dev.running'), false);
  assert.equal(
    state.notices.some((message) => message.includes('started at')),
    false
  );
});

test('stop invalidates a start command that has not executed yet', async () => {
  const state = setup();
  await Promise.all([state.manager.start(), state.manager.stop()]);
  assert.equal(state.created, 0);
});
