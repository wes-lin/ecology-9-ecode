const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { EcodeDevProxyServer } = require('../dist');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe('EcodeDevProxyServer', () => {
  it('serves cloudstore files locally and proxies other requests', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-dev-proxy-'));
    const localFile = path.join(projectRoot, 'dist', 'release', 'app-id', 'index.js');
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, 'window.fromLocal = true;', 'utf8');

    const upstream = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ host: request.headers.host, url: request.url }));
    });
    const upstreamAddress = await listen(upstream);
    const proxy = new EcodeDevProxyServer({
      projectRoot,
      target: `http://127.0.0.1:${upstreamAddress.port}`,
      port: 0,
    });

    try {
      const address = await proxy.start();
      const localResponse = await fetch(`${address.url}/cloudstore/release/app-id/index.js?v=1`);
      assert.equal(localResponse.status, 200);
      assert.equal(await localResponse.text(), 'window.fromLocal = true;');
      assert.equal(localResponse.headers.get('cache-control'), 'no-store');

      const proxyResponse = await fetch(`${address.url}/api/test?value=1`);
      const proxyBody = await proxyResponse.json();
      assert.equal(proxyBody.host, `127.0.0.1:${upstreamAddress.port}`);
      assert.equal(proxyBody.url, '/api/test?value=1');

      const missingResponse = await fetch(`${address.url}/cloudstore/dev/init.js`);
      assert.equal(missingResponse.status, 404);
    } finally {
      await proxy.stop();
      await closeServer(upstream);
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('rewrites upstream redirects and cookie domains to the local origin', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-dev-proxy-'));
    const upstream = http.createServer((_request, response) => {
      response.writeHead(302, {
        location: '/login',
        'set-cookie': ['sid=123; Domain=example.test; Path=/; HttpOnly'],
      });
      response.end();
    });
    const upstreamAddress = await listen(upstream);
    const proxy = new EcodeDevProxyServer({
      projectRoot,
      target: `http://127.0.0.1:${upstreamAddress.port}`,
      port: 0,
    });

    try {
      const address = await proxy.start();
      const response = await fetch(`${address.url}/redirect`, { redirect: 'manual' });
      assert.equal(response.headers.get('location'), `${address.url}/login`);
      assert.doesNotMatch(response.headers.get('set-cookie') || '', /Domain=/i);
    } finally {
      await proxy.stop();
      await closeServer(upstream);
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('forwards WebSocket upgrade handshakes', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-dev-proxy-'));
    const upstream = http.createServer();
    upstream.on('upgrade', (request, socket) => {
      assert.equal(request.url, '/socket?channel=ecode');
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    });
    const upstreamAddress = await listen(upstream);
    const proxy = new EcodeDevProxyServer({
      projectRoot,
      target: `http://127.0.0.1:${upstreamAddress.port}`,
      port: 0,
    });

    try {
      const address = await proxy.start();
      const response = await new Promise((resolve, reject) => {
        const socket = net.connect(address.port, address.host, () => {
          socket.write(
            `GET /socket?channel=ecode HTTP/1.1\r\nHost: ${address.host}:${address.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`
          );
        });
        socket.setEncoding('utf8');
        socket.once('data', (data) => {
          socket.destroy();
          resolve(data);
        });
        socket.once('error', reject);
      });
      assert.match(response, /101 Switching Protocols/);
    } finally {
      await proxy.stop();
      await closeServer(upstream);
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
