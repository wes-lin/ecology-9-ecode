const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { EcodeDevRuntime } = require('../dist/runtime');

test('batches externally reported source changes in the runtime queue', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-runtime-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const runtime = new EcodeDevRuntime({ projectRoot, watchDebounceMs: 60_000 });
  const rebuilt = [];
  runtime.builder.rebuildFiles = async (files) => {
    rebuilt.push(files);
    return { builtAppIds: [], durationMs: 0 };
  };

  runtime.notifyFileChange(path.join(projectRoot, 'src', 'app', 'a.js'));
  runtime.notifyFileChange(path.join(projectRoot, 'src', 'app', 'b.css'));
  await runtime.flushChanges();

  assert.equal(rebuilt.length, 1);
  assert.deepEqual(rebuilt[0].map((file) => path.basename(file)).sort(), ['a.js', 'b.css']);
  await runtime.dispose();
});

test('configuration changes supersede pending source rebuilds', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-runtime-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const runtime = new EcodeDevRuntime({ projectRoot, watchDebounceMs: 60_000 });
  let rebuildCount = 0;
  let reloadCount = 0;
  runtime.builder.rebuildFiles = async () => {
    rebuildCount += 1;
    return { builtAppIds: [], durationMs: 0 };
  };
  runtime.builder.reloadConfiguration = async () => {
    reloadCount += 1;
    return { builtAppIds: [], durationMs: 0 };
  };

  runtime.notifyFileChange(path.join(projectRoot, 'src', 'app', 'a.js'));
  runtime.notifyConfigurationChange();
  await runtime.flushChanges();

  assert.equal(reloadCount, 1);
  assert.equal(rebuildCount, 0);
  await runtime.dispose();
});

test('ignores temporary files reported by the external watcher', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-runtime-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const runtime = new EcodeDevRuntime({ projectRoot, watchDebounceMs: 60_000 });
  const rebuilt = [];
  runtime.builder.rebuildFiles = async (files) => {
    rebuilt.push(files);
    return { builtAppIds: [], durationMs: 0 };
  };

  runtime.notifyFileChange(path.join(projectRoot, 'src', 'app', 'index.js.git'));
  runtime.notifyFileChange(path.join(projectRoot, 'src', 'app', 'index.js'));
  await runtime.flushChanges();

  assert.equal(rebuilt.length, 1);
  assert.deepEqual(rebuilt[0].map((file) => path.basename(file)), ['index.js']);
  await runtime.dispose();
});
