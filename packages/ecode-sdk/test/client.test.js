const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EcodeClient, CookieJar } = require('../dist/client.js');
const { EcodeLogger, NOOP_LOGGER } = require('../dist/logger.js');

describe('ecode-sdk exports', () => {
  it('should export EcodeClient', () => {
    assert.ok(EcodeClient);
  });

  it('should export CookieJar', () => {
    assert.ok(CookieJar);
  });

  it('should export EcodeLogger', () => {
    assert.ok(EcodeLogger);
  });

  it('should export NOOP_LOGGER', () => {
    assert.ok(NOOP_LOGGER);
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

  it('should use an absolute API path when updating a folder name', async () => {
    const client = new EcodeClient({ baseUrl: 'http://example.com' });
    let request;
    client._post = async (apiPath, body) => {
      request = { apiPath, body };
    };

    await client.updateFolderName('folder-1', 'Renamed');

    assert.deepStrictEqual(request, {
      apiPath: '/api/cloudstore/ecode/updateFolderName',
      body: { folderId: 'folder-1', name: 'Renamed' },
    });
  });

  it('should use NOOP_LOGGER when no logger option is provided', () => {
    const client = new EcodeClient({ baseUrl: 'http://example.com' });
    assert.strictEqual(client.logger, NOOP_LOGGER);
  });

  it('should accept an EcodeLogger instance as logger', () => {
    const logger = new EcodeLogger({ level: 'debug', console: false });
    const client = new EcodeClient({ baseUrl: 'http://example.com', logger });
    assert.strictEqual(client.logger, logger);
  });

  it('should construct EcodeLogger from plain config object', () => {
    const client = new EcodeClient({
      baseUrl: 'http://example.com',
      logger: { level: 'warn', console: false },
    });
    assert.ok(client.logger instanceof EcodeLogger);
  });
});

describe('CookieJar', () => {
  it('should parse and store cookies', () => {
    const jar = new CookieJar();
    jar.setCookie(['sessionid=abc123; Path=/', 'token=xyz; HttpOnly']);
    assert.strictEqual(jar.getCookieString(), 'sessionid=abc123; token=xyz');
  });
});

describe('EcodeLogger', () => {
  it('should default level to info', () => {
    const logger = new EcodeLogger({ console: false });
    // info level index = 1
    const { LEVELS } = require('../dist/logger.js');
    assert.strictEqual(logger.level, LEVELS.info);
  });

  it('NOOP_LOGGER should have all required methods', () => {
    const methods = ['debug', 'info', 'warn', 'error', 'logRequest', 'logResponse', 'logSessionExpired'];
    for (const m of methods) {
      assert.strictEqual(typeof NOOP_LOGGER[m], 'function', `NOOP_LOGGER.${m} should be a function`);
    }
  });

  it('should redact sensitive headers', () => {
    const logger = new EcodeLogger({ console: false });
    const result = logger._redactHeaders({ Cookie: 'sessionid=abc', 'X-Custom': 'value' });
    assert.strictEqual(result['Cookie'], '[REDACTED]');
    assert.strictEqual(result['X-Custom'], 'value');
  });

  it('should not redact when redact=false', () => {
    const logger = new EcodeLogger({ console: false, redact: false });
    const result = logger._redactHeaders({ Cookie: 'sessionid=abc' });
    assert.strictEqual(result['Cookie'], 'sessionid=abc');
  });

  it('should write to file when file option is set', () => {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const tmpFile = path.join(os.tmpdir(), `ecode-test-${Date.now()}.log`);
    const logger = new EcodeLogger({ level: 'debug', console: false, file: tmpFile });
    logger.info('test message', { key: 'value' });
    assert.ok(fs.existsSync(tmpFile), 'log file should be created');
    const content = fs.readFileSync(tmpFile, 'utf-8');
    assert.ok(content.includes('test message'));
    fs.unlinkSync(tmpFile);
  });
});
