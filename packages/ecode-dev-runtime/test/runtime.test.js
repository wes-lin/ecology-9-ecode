const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { EcodeDevRuntime } = require('../dist/runtime');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('coalesces multiple event batches while a build is in progress', async () => {
  const runtime = new EcodeDevRuntime({ projectRoot: os.tmpdir(), watchDebounceMs: 60_000 });
  const entered = deferred();
  const release = deferred();
  runtime.builder.build = async () => {
    entered.resolve();
    await release.promise;
  };
  let reloads = 0;
  runtime.builder.reloadConfiguration = async () => {
    reloads += 1;
  };
  runtime.builder.rebuildFiles = async () => assert.fail('metadata should supersede source changes');
  const building = runtime.build();
  await entered.promise;
  runtime.notifyFileChange(path.join(os.tmpdir(), 'src/a.js'));
  const first = runtime.flushChanges();
  runtime.notifyConfigurationChange();
  const second = runtime.flushChanges();
  runtime.notifyConfigurationChange();
  const third = runtime.flushChanges();
  release.resolve();
  await Promise.all([building, first, second, third]);
  assert.equal(reloads, 1);
  await runtime.dispose();
});

test('dispose cancels queued builds and ignores subsequent watcher callbacks', async () => {
  const runtime = new EcodeDevRuntime({ projectRoot: os.tmpdir(), watchDebounceMs: 60_000 });
  const entered = deferred();
  const release = deferred();
  runtime.builder.build = async () => {
    entered.resolve();
    await release.promise;
  };
  runtime.builder.rebuildFiles = async () => assert.fail('queued rebuild ran after stop');
  const building = runtime.build();
  await entered.promise;
  runtime.notifyFileChange(path.join(os.tmpdir(), 'src/a.js'));
  const queued = assert.rejects(runtime.flushChanges(), { name: 'AbortError' });
  const stopping = runtime.dispose();
  runtime.notifyConfigurationChange();
  runtime.notifyFileChange(path.join(os.tmpdir(), 'src/b.js'));
  release.resolve();
  await Promise.all([building, stopping, queued]);
  assert.equal(await runtime.flushChanges(), undefined);
  await assert.rejects(runtime.build(), { name: 'AbortError' });
});

test('changes during an active rebuild produce one follow-up batch', async () => {
  const runtime = new EcodeDevRuntime({ projectRoot: os.tmpdir(), watchDebounceMs: 60_000 });
  const entered = deferred();
  const release = deferred();
  const batches = [];
  runtime.builder.rebuildFiles = async (files) => {
    batches.push(files.map((file) => path.basename(file)));
    if (batches.length === 1) {
      entered.resolve();
      await release.promise;
    }
  };
  runtime.notifyFileChange(path.join(os.tmpdir(), 'src/a.js'));
  const first = runtime.flushChanges();
  await entered.promise;
  runtime.notifyFileChange(path.join(os.tmpdir(), 'src/b.js'));
  const second = runtime.flushChanges();
  runtime.notifyFileChange(path.join(os.tmpdir(), 'src/c.js'));
  const third = runtime.flushChanges();
  release.resolve();
  await Promise.all([first, second, third]);
  assert.deepEqual(batches, [['a.js'], ['b.js', 'c.js']]);
  await runtime.dispose();
});

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
  assert.deepEqual(
    rebuilt[0].map((file) => path.basename(file)),
    ['index.js']
  );
  await runtime.dispose();
});
