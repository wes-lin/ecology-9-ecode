import { createReadStream, promises as fs } from 'node:fs';
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import * as net from 'node:net';
import * as path from 'node:path';
import * as tls from 'node:tls';
import type { Duplex } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveInside } from './paths';
import { NOOP_DEV_LOGGER, type EcodeDevLogger, type EcodeDevProxyOptions, type EcodeDevServerAddress } from './types';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function getLocalRelativePath(requestUrl: string): string | undefined {
  const pathname = new URL(requestUrl, 'http://ecode.local').pathname;
  if (pathname === '/cloudstore/dev/init.js') return path.join('dev', 'init.js');
  if (pathname === '/cloudstore/dev/init.css') return path.join('dev', 'init.css');
  if (pathname.startsWith('/cloudstore/release/')) {
    const relative = decodeURIComponent(pathname.slice('/cloudstore/release/'.length));
    return relative ? path.join('release', relative) : undefined;
  }
  return undefined;
}

function getTargetPath(target: URL, requestUrl: string): string {
  const incoming = new URL(requestUrl, 'http://ecode.local');
  const basePath = target.pathname.replace(/\/$/, '');
  return `${basePath}${incoming.pathname}${incoming.search}` || '/';
}

function getLocalOrigin(request: IncomingMessage, address: EcodeDevServerAddress | undefined): string | undefined {
  const host = request.headers.host;
  if (host) return `http://${host}`;
  return address?.url;
}

function rewriteLocation(value: string, target: URL, localOrigin: string | undefined): string {
  if (!localOrigin) return value;
  try {
    const location = new URL(value, target);
    if (location.origin !== target.origin) return value;
    return `${localOrigin}${location.pathname}${location.search}${location.hash}`;
  } catch {
    return value;
  }
}

function rewriteCookie(value: string): string {
  return value.replace(/;\s*Domain=[^;]+/gi, '');
}

export class EcodeDevProxyServer {
  readonly outputDirectory: string;
  readonly target: URL;
  private readonly host: string;
  private readonly port: number;
  private readonly changeOrigin: boolean;
  private readonly strictSSL: boolean;
  private readonly rewriteCookies: boolean;
  private readonly rewriteRedirects: boolean;
  private readonly logger: EcodeDevLogger;
  private readonly upgradedSockets = new Set<Duplex>();
  private server?: Server;
  private address?: EcodeDevServerAddress;

  constructor(options: EcodeDevProxyOptions) {
    this.outputDirectory = path.resolve(options.projectRoot, options.outputDirectory || 'dist');
    this.target = new URL(options.target);
    if (!['http:', 'https:'].includes(this.target.protocol)) {
      throw new Error(`Unsupported eCode proxy protocol: ${this.target.protocol}`);
    }
    this.host = options.host || '127.0.0.1';
    this.port = options.port ?? 9090;
    this.changeOrigin = options.changeOrigin !== false;
    this.strictSSL = options.strictSSL !== false;
    this.rewriteCookies = options.rewriteCookies !== false;
    this.rewriteRedirects = options.rewriteRedirects !== false;
    this.logger = options.logger || NOOP_DEV_LOGGER;
  }

  get serverAddress(): EcodeDevServerAddress | undefined {
    return this.address;
  }

  async start(): Promise<EcodeDevServerAddress> {
    if (this.server && this.address) return this.address;
    const server = createHttpServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        this.logger.error('eCode development proxy request failed.', error);
        if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Bad Gateway');
      });
    });
    server.on('upgrade', (request, socket, head) => this.handleUpgrade(request, socket, head));
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once('error', onError);
      server.listen(this.port, this.host, () => {
        server.off('error', onError);
        resolve();
      });
    });
    const bound = server.address();
    if (!bound || typeof bound === 'string') {
      server.close();
      throw new Error('Unable to determine eCode development proxy address.');
    }
    this.server = server;
    this.address = { host: this.host, port: bound.port, url: `http://${this.host}:${bound.port}` };
    this.logger.info(`eCode development proxy listening at ${this.address.url}.`);
    return this.address;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.address = undefined;
    if (!server) return;
    this.upgradedSockets.forEach((socket) => socket.destroy());
    this.upgradedSockets.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections?.();
    });
    this.logger.info('eCode development proxy stopped.');
  }

  private async handleRequest(request: IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
    const localRelativePath = getLocalRelativePath(request.url || '/');
    if (localRelativePath) {
      await this.serveLocalFile(localRelativePath, request, response);
      return;
    }
    await this.proxyRequest(request, response);
  }

  private async serveLocalFile(
    relativePath: string,
    request: IncomingMessage,
    response: import('node:http').ServerResponse
  ): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let filePath: string;
    try {
      filePath = resolveInside(this.outputDirectory, relativePath, 'Local cloudstore path');
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Bad Request');
      return;
    }
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': stat.size,
        'content-type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      });
      if (request.method === 'HEAD') response.end();
      else await pipeline(createReadStream(filePath), response);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
    }
  }

  private async proxyRequest(request: IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
    const headers = { ...request.headers };
    if (this.changeOrigin) headers.host = this.target.host;
    const requestFn = this.target.protocol === 'https:' ? httpsRequest : httpRequest;
    await new Promise<void>((resolve, reject) => {
      const upstream = requestFn(
        {
          protocol: this.target.protocol,
          hostname: this.target.hostname,
          port: this.target.port || undefined,
          method: request.method,
          path: getTargetPath(this.target, request.url || '/'),
          headers,
          rejectUnauthorized: this.strictSSL,
        },
        (upstreamResponse) => {
          const responseHeaders = { ...upstreamResponse.headers };
          const localOrigin = getLocalOrigin(request, this.address);
          if (this.rewriteRedirects && typeof responseHeaders.location === 'string') {
            responseHeaders.location = rewriteLocation(responseHeaders.location, this.target, localOrigin);
          }
          if (this.rewriteCookies && responseHeaders['set-cookie']) {
            responseHeaders['set-cookie'] = responseHeaders['set-cookie'].map(rewriteCookie);
          }
          response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
          upstreamResponse.pipe(response);
          upstreamResponse.once('end', resolve);
          upstreamResponse.once('error', reject);
        }
      );
      upstream.once('error', reject);
      request.once('error', reject);
      request.pipe(upstream);
    });
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (getLocalRelativePath(request.url || '/')) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const port = Number(this.target.port || (this.target.protocol === 'https:' ? 443 : 80));
    const onConnected = (): void => {
      const headers = { ...request.headers };
      if (this.changeOrigin) headers.host = this.target.host;
      const lines = [`${request.method || 'GET'} ${getTargetPath(this.target, request.url || '/')} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        if (Array.isArray(value)) value.forEach((entry) => lines.push(`${name}: ${entry}`));
        else if (value !== undefined) lines.push(`${name}: ${value}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    };
    const upstream =
      this.target.protocol === 'https:'
        ? tls.connect(
            { host: this.target.hostname, port, servername: this.target.hostname, rejectUnauthorized: this.strictSSL },
            onConnected
          )
        : net.connect({ host: this.target.hostname, port }, onConnected);
    this.upgradedSockets.add(socket);
    this.upgradedSockets.add(upstream);
    const removeSockets = (): void => {
      this.upgradedSockets.delete(socket);
      this.upgradedSockets.delete(upstream);
    };
    const closeWithBadGateway = (error: Error): void => {
      this.logger.error('eCode WebSocket proxy failed.', error);
      if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    };
    upstream.once('error', closeWithBadGateway);
    upstream.once('close', removeSockets);
    socket.once('close', removeSockets);
    socket.once('error', () => upstream.destroy());
  }
}
