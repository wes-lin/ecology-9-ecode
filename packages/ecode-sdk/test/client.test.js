const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

  it('should import multiple apps with per-app operations', async () => {
    const client = new EcodeClient({ baseUrl: 'http://example.com' });
    let request;
    client._post = async (apiPath, body) => {
      request = { apiPath, body };
    };

    await client.importApps(846001, {
      '6bbdf5da9e2c4e0daf37e6ba3cce9e01': {
        cover: 'y',
        autoRelease: 'y',
        coverConfig: 'n',
      },
      '591a8ccf800d4c0a97b7e02c36ce02d1': {
        cover: 'y',
        autoRelease: 'y',
        coverConfig: 'n',
      },
    });

    assert.deepStrictEqual(request, {
      apiPath: '/api/ecode/type/importDemo',
      body: {
        fileId: 846001,
        impOp: JSON.stringify({
          '6bbdf5da9e2c4e0daf37e6ba3cce9e01': {
            cover: 'y',
            autoRelease: 'y',
            coverConfig: 'n',
          },
          '591a8ccf800d4c0a97b7e02c36ce02d1': {
            cover: 'y',
            autoRelease: 'y',
            coverConfig: 'n',
          },
        }),
      },
    });
  });

  it('should build default import operations from app ids', async () => {
    const client = new EcodeClient({ baseUrl: 'http://example.com' });
    let request;
    client._post = async (apiPath, body) => {
      request = { apiPath, body };
    };

    await client.importApps('846001', ['app-a', 'app-b']);

    assert.deepStrictEqual(JSON.parse(request.body.impOp), {
      'app-a': { cover: 'y', autoRelease: 'y', coverConfig: 'n' },
      'app-b': { cover: 'y', autoRelease: 'y', coverConfig: 'n' },
    });
  });

  it('should upload document and resource files as native multipart form data', async () => {
    const client = new EcodeClient({ baseUrl: 'http://example.com' });
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-upload-'));
    const filePath = path.join(tempDirectory, 'app.zip');
    fs.writeFileSync(filePath, 'zip-content');
    let request;
    client._post = async (apiPath, body, headers) => {
      request = { apiPath, body, headers };
    };

    try {
      await client.uploadFile(filePath);

      assert.strictEqual(request.apiPath, '/api/doc/upload/uploadFile');
      assert.ok(request.body instanceof FormData);
      assert.strictEqual(request.headers, undefined);
      const uploadedFile = request.body.get('Filedata');
      assert.ok(uploadedFile instanceof Blob);
      assert.strictEqual(uploadedFile.name, 'app.zip');
      assert.strictEqual(Buffer.from(await uploadedFile.arrayBuffer()).toString('utf8'), 'zip-content');

      await client.uploadResource(filePath, 'folder-1');

      assert.strictEqual(request.apiPath, '/api/ecode/resource/upload?folderId=folder-1');
      assert.ok(request.body instanceof FormData);
      assert.strictEqual(request.headers, undefined);
      const uploadedResource = request.body.get('file');
      assert.ok(uploadedResource instanceof Blob);
      assert.strictEqual(uploadedResource.name, 'app.zip');
      assert.strictEqual(Buffer.from(await uploadedResource.arrayBuffer()).toString('utf8'), 'zip-content');
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
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

  it('should reject API-level failures instead of treating them as successful responses', async () => {
    const originalFetch = global.fetch;
    const client = new EcodeClient({ baseUrl: 'http://example.com' });
    client.jar.setCookie('session=test');
    global.fetch = async () =>
      new Response(JSON.stringify({ api_status: false, msg: 'Business failure' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    try {
      await assert.rejects(client._get('/api/test'), /Business failure/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should validate the API result returned after a session-expiry retry', async () => {
    const originalFetch = global.fetch;
    const client = new EcodeClient({ baseUrl: 'http://example.com' });
    client.jar.setCookie('session=expired');
    let requestCount = 0;
    let loginCount = 0;
    client.login = async () => {
      loginCount += 1;
      client.jar.setCookie('session=renewed');
    };
    global.fetch = async () => {
      requestCount += 1;
      const payload =
        requestCount === 1 ? { errorCode: '002', msg: '登录信息超时' } : { api_status: false, msg: 'Retry failure' };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    try {
      await assert.rejects(client._get('/api/test'), /Retry failure/);
      assert.strictEqual(loginCount, 1);
      assert.strictEqual(requestCount, 2);
    } finally {
      global.fetch = originalFetch;
    }
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
