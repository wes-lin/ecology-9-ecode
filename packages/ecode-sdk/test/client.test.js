const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EcodeClient } = require('../src/client.js');

describe('ecode-sdk exports', () => {
  it('should export EcodeClient', () => {
    assert.ok(EcodeClient);
  });
});

describe('EcodeClient', () => {
  it('should store options', () => {
    const client = new EcodeClient({
      baseUrl: 'http://example.com',
      username: 'sysadmin',
      password: 'secret',
    });

    assert.strictEqual(client.baseUrl, 'http://example.com');
    assert.strictEqual(client.username, 'sysadmin');
    assert.strictEqual(client.password, 'secret');
  });

  it('should require login before API calls', async () => {
    const client = new EcodeClient({ baseUrl: 'http://example.com' });
    await assert.rejects(client.listTree('/'), /Not logged in/);
  });
});
