const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { publishAppUpgradePackage } = require('../dist');

describe('eCode app package publisher', () => {
  it('uploads and imports all apps with release-aware operations', async () => {
    let uploadedPath;
    let importedFileId;
    let importOperations;
    const client = {
      async uploadFile(archivePath) {
        uploadedPath = archivePath;
        return new Response(JSON.stringify({ data: { fileid: 846001 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      async importApps(fileId, operations) {
        importedFileId = fileId;
        importOperations = operations;
        return new Response('{}', { status: 200 });
      },
    };

    const result = await publishAppUpgradePackage(client, 'apps.zip', [
      { appId: 'app-released', appStatus: 'released' },
      { appId: 'app-draft', appStatus: 'draft' },
    ]);

    assert.equal(uploadedPath, 'apps.zip');
    assert.equal(importedFileId, 846001);
    assert.deepEqual(importOperations, {
      'app-released': { cover: 'y', autoRelease: 'y', coverConfig: 'n' },
      'app-draft': { cover: 'y', autoRelease: 'n', coverConfig: 'n' },
    });
    assert.deepEqual(result, { appIds: ['app-released', 'app-draft'], fileId: 846001 });
  });

  it('rejects an upload response without data.fileid', async () => {
    const client = {
      async uploadFile() {
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      async importApps() {
        throw new Error('must not import');
      },
    };

    await assert.rejects(
      publishAppUpgradePackage(client, 'apps.zip', [{ appId: 'app-a', appStatus: 'released' }]),
      /data\.fileid is missing/
    );
  });
});
