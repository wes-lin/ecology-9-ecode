const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const { BUNDLED_ECODE_ASSETS, BUNDLED_ECODE_ASSET_VERSION, getBundledPreStateBaseJavaScriptFiles } = require('../dist');

describe('bundled eCode assets', () => {
  it('ships the versioned files with their declared checksums', () => {
    assert.equal(BUNDLED_ECODE_ASSET_VERSION, '1');
    const paths = getBundledPreStateBaseJavaScriptFiles();
    assert.deepEqual(
      paths.map((filePath) => filePath.replace(/\\/g, '/').split('/').at(-1)),
      BUNDLED_ECODE_ASSETS.map((asset) => asset.name)
    );

    for (const [index, filePath] of paths.entries()) {
      const digest = nodeCrypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
      assert.equal(digest, BUNDLED_ECODE_ASSETS[index].sha256);
    }
  });
});
