const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EcodeClient, CookieJar } = require('../src/client.js');

describe('ecode-sdk exports', () => {
  it('should export EcodeClient', () => {
    assert.ok(EcodeClient);
  });

  it('should export CookieJar', () => {
    assert.ok(CookieJar);
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

  it('should build URL with query params in _get', async () => {
    const client = new EcodeClient({ baseUrl: 'http://example.com' });
    const params = { folderId: '123', typeId: '456' };
    const url = client._buildUrl('/api/ecode/type/tree', params);
    assert.ok(url.includes('folderId=123'));
    assert.ok(url.includes('typeId=456'));
  });
});

describe('CookieJar', () => {
  it('should parse and store cookies', () => {
    const jar = new CookieJar();
    jar.setCookie(['sessionid=abc123; Path=/', 'token=xyz; HttpOnly']);
    assert.strictEqual(jar.getCookieString(), 'sessionid=abc123; token=xyz');
  });
});
