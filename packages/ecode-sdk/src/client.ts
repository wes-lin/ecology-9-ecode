import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import FormData from 'form-data';
import { EcodeLogger, type EcodeLoggerLike, type EcodeLoggerOptions, NOOP_LOGGER } from './logger';
import { RemoteTreeItem } from './type';
import { compileJavaScript } from './compiler';
import { downloadEcode, type EcodeDownloadOptions, type EcodeDownloadResult } from './downloader';

type PrimitiveParam = string | number | boolean | null | undefined;
type Params = Record<string, PrimitiveParam>;
type RequestBody = BodyInit | FormData | Params;

type RequestOptions = {
  method?: string;
  params?: Params;
  headers?: Record<string, string>;
  body?: RequestBody;
};

type RsaInfo = {
  rsa_pub: string;
  rsa_code: string;
  rsa_flag: string;
};

export type EcodeClientOptions = {
  baseUrl?: string;
  username?: string;
  password?: string;
  cookieFile?: string | null;
  logger?: EcodeLogger | EcodeLoggerLike | EcodeLoggerOptions;
};

/**
 * 将裸 base64 公钥字符串包装为合法 PEM 格式（每 64 字符换行）
 * @param pubKey 纯 base64 公钥内容（不含 PEM 头尾）
 * @returns 合法的 PEM 字符串
 */
function wrapPem(pubKey: string): string {
  // 去掉可能已有的换行和头尾标记，取纯 base64
  const raw = pubKey
    .replace(/-----BEGIN[^-]+-----/g, '')
    .replace(/-----END[^-]+-----/g, '')
    .replace(/[\s\r\n]/g, '');

  const lines: string[] = [];
  for (let i = 0; i < raw.length; i += 64) {
    lines.push(raw.substring(i, i + 64));
  }
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

/**
 * RSA 加密（PKCS#1 v1.5 padding，与 JSEncrypt 行为一致）
 * @param pubKey 纯 base64 公钥或完整 PEM
 * @param content 待加密明文
 * @returns base64 编码的密文
 */
function rsaEncrypt(pubKey: string, content: string): string {
  const pem = pubKey.includes('-----BEGIN') ? pubKey : wrapPem(pubKey);
  const buffer = Buffer.from(content, 'utf8');
  const encrypted = crypto.publicEncrypt(
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_PADDING, // 关键：与 JSEncrypt 一致
    },
    buffer
  );
  return encrypted.toString('base64');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function getSetCookieHeaders(headers: Headers): string[] {
  const compatibleHeaders = headers as Headers & {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
  };

  if (typeof compatibleHeaders.getSetCookie === 'function') {
    return compatibleHeaders.getSetCookie();
  }

  if (typeof compatibleHeaders.raw === 'function') {
    return compatibleHeaders.raw()['set-cookie'] ?? [];
  }

  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

export class CookieJar {
  cookies: Map<string, string>;

  constructor() {
    this.cookies = new Map();
  }

  setCookie(setCookieHeader?: string | string[] | null): void {
    if (!setCookieHeader) return;

    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const cookie of cookies) {
      const [nameValue] = cookie.split(';');
      const [name, value] = nameValue.trim().split('=');
      if (name) {
        this.cookies.set(name, value || '');
      }
    }
  }

  getCookieString(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  loadFromFile(filePath?: string | null): void {
    if (!filePath || !existsSync(filePath)) return;
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      if (isRecord(data)) {
        for (const [name, value] of Object.entries(data)) {
          this.cookies.set(name, String(value));
        }
      }
    } catch {
      // ignore invalid cookie file
    }
  }

  saveToFile(filePath?: string | null): void {
    if (!filePath) return;
    const data = Object.fromEntries(this.cookies.entries());
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  clear(): void {
    this.cookies.clear();
  }
}

export class EcodeClient {
  baseUrl: string;
  username: string;
  password: string;
  cookieFile: string | null;
  jar: CookieJar;
  logger: EcodeLogger | EcodeLoggerLike;

  /**
   * @param options
   * @param options.baseUrl
   * @param options.username
   * @param options.password
   * @param options.cookieFile
   * @param options.logger
   *   传入已实例化的 EcodeLogger，或一个符合相同接口的对象。
   *   也可以传入 { level, file, console, colors, redact } 配置对象，
   *   SDK 会自动构造 EcodeLogger。
   *   不传则静默（不打印任何日志）。
   */
  constructor(options: EcodeClientOptions = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost';
    this.username = options.username || '';
    this.password = options.password || '';
    this.cookieFile = options.cookieFile || null;
    this.jar = new CookieJar();
    this.jar.loadFromFile(this.cookieFile);

    // 初始化 logger
    const loggerOpt = options.logger;
    if (!loggerOpt) {
      this.logger = NOOP_LOGGER;
    } else if (loggerOpt instanceof EcodeLogger || 'logRequest' in loggerOpt) {
      // 已是 logger 实例或自定义兼容对象，直接使用
      this.logger = loggerOpt;
    } else {
      // 将 options.logger 作为 EcodeLogger 的配置项构造
      this.logger = new EcodeLogger(loggerOpt);
    }
  }

  isLoggedIn(): boolean {
    return !!this.jar.getCookieString();
  }

  getRsaInfo(): Promise<RsaInfo> {
    return fetch(`${this.baseUrl}/rsa/weaver.rsa.GetRsaInfo`).then((res) => res.json() as Promise<RsaInfo>);
  }

  encryptWithRsa(rsaInfo: RsaInfo, text: string): string {
    const { rsa_pub, rsa_code, rsa_flag } = rsaInfo;
    let data = '';
    const groupLength = 240;
    if (text.length > groupLength) {
      // 需要分段加密
      const length = text.length;
      const groups = Math.floor(length / groupLength) + 1;
      for (let i = 0; i < groups; i++) {
        let v = '';
        if (i !== groups - 1) {
          v = text.substring(i * groupLength, (i + 1) * groupLength);
        } else {
          v = text.substring(i * groupLength);
        }
        if (v) {
          data += rsaEncrypt(rsa_pub, v + rsa_code) + rsa_flag;
        }
      }
    } else {
      data = rsaEncrypt(rsa_pub, text + rsa_code) + rsa_flag;
    }
    return data;
  }

  async login(): Promise<unknown> {
    this.logger.info('Logging in…', { username: this.username });

    const rsaInfo = await this.getRsaInfo();
    const encryptedLoginId = this.encryptWithRsa(rsaInfo, this.username);
    const encryptedPassword = this.encryptWithRsa(rsaInfo, this.password);

    const formData = new URLSearchParams();
    formData.append('islanguid', '7');
    formData.append('loginid', encryptedLoginId);
    formData.append('userpassword', encryptedPassword);
    formData.append('logintype', '1');
    formData.append('isie', 'false');

    // 直接调用 fetch，避免经过 _request 产生递归
    const url = this._buildUrl('/api/hrm/login/checkLogin');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData,
    });

    if (res.status !== 200) {
      this.logger.error(`Login failed: HTTP ${res.status}`);
      throw new Error(`Login failed: HTTP ${res.status}`);
    }
    const resData = (await res.json()) as Record<string, unknown>;

    if (resData.msgcode === '0') {
      this.logger.info('Login successful');
    } else {
      this.logger.error('Login rejected by server', { msgcode: resData.msgcode, msg: resData.msg });
      throw new Error(`${resData.msg}`);
    }

    this.jar.clear();
    this.jar.setCookie(getSetCookieHeaders(res.headers));

    if (!this.jar.getCookieString()) {
      throw new Error('Login succeeded but server did not set a session cookie.');
    }

    this.jar.saveToFile(this.cookieFile);
    return resData;
  }

  async logout(): Promise<void> {
    this.logger.info('Logging out');
    this.jar.clear();
    if (this.cookieFile) {
      this.jar.saveToFile(this.cookieFile);
    }
  }

  async listTree(folderId = '', typeId = ''): Promise<RemoteTreeItem[]> {
    const res = await this._get('/api/ecode/type/tree', { folderId, typeId });
    const treeData = (await res.json()) as Record<string, RemoteTreeItem[]>;
    return ([] as RemoteTreeItem[]).concat(
      treeData.system || [],
      treeData.typeList || [],
      treeData.childFolder || [],
      treeData.childFile || [],
      treeData.resources || []
    );
  }

  async viewFile(id: string): Promise<string> {
    const res = await this._get('/api/cloudstore/ecode/one', { id });
    const resData = (await res.json()) as { data?: { content?: string } };
    return resData.data?.content?.trim() ?? '';
  }

  async viewResource(route: string): Promise<Buffer> {
    const res = await this._get(route);
    if (!res.ok) {
      throw new Error(`View resource failed: HTTP ${res.status}, path: ${route}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async download(outputRoot: string, options: EcodeDownloadOptions = {}): Promise<EcodeDownloadResult> {
    return downloadEcode(this, outputRoot, options);
  }

  async markFile(id: string, type?: string) {
    return await this._post('/api/cloudstore/ecode/markFile', {
      id,
      type,
    });
  }

  async release(folderId: string) {
    return await this._post('/api/cloudstore/ecode/release', {
      folderId,
    });
  }

  async deleteReleaseFile(folderIds: string) {
    return await this._post('/api/cloudstore/ecode/deleteReleaseFile', {
      folderIds,
    });
  }

  async setPreStateOrder(appId: string, preStateOrder: number) {
    return await this._post('/api/cloudstore/ecode/deleteReleaseFile', {
      appId,
      preStateOrder,
    });
  }

  async updateTypeName(id: string, name: string) {
    return await this._post('/api/ecode/type/updateName', {
      id,
      name,
    });
  }

  async updateFolderName(folderId: string, name: string) {
    return await this._post('api/cloudstore/ecode/updateFolderName', {
      folderId,
      name,
    });
  }

  async updateFileName(id: string, name: string) {
    return await this._post('/api/cloudstore/ecode/updateName', {
      id,
      name,
    });
  }

  async addType(name: string, parentId?: string) {
    return await this._post('/api/ecode/type/add', { name, parentId });
  }

  async addFolder(name: string, parentId?: string, typeId?: string) {
    return await this._post('/api/cloudstore/ecode/addFolder', {
      parentId,
      name,
      typeId,
    });
  }

  async addFile(folderId: string, name: string, type: 'js' | 'css' | 'md') {
    return await this._post('/api/cloudstore/ecode/addFile', {
      folderId,
      name,
      type,
    });
  }

  async deleteFile(id: string) {
    return await this._post('/api/cloudstore/ecode/logicalDeleteFile', { id });
  }

  async deleteFolder(folderId: string) {
    return await this._post('/api/cloudstore/ecode/logicalDeleteFolder', { folderId });
  }

  async deleteType(id: string) {
    return await this._post('/api/ecode/type/logicalDelete', { id });
  }

  async deleteResource(resourceId: string) {
    return await this._post('/api/ecode/resource/remove', { resourceId });
  }

  async updateFile(id: string, content: string, isJs: boolean): Promise<Response> {
    const base64Content = Buffer.from(content, 'utf-8').toString('base64');
    const compiledContent = isJs ? await compileJavaScript(content) : content;
    const base64CompiledContent = Buffer.from(compiledContent, 'utf-8').toString('base64');
    return await this._post('/api/cloudstore/ecode/updateFile', {
      id,
      content: base64Content,
      compiledContent: base64CompiledContent,
    });
  }

  async uploadFile(localPath: string, folderId: string): Promise<Response> {
    const form = new FormData();
    form.append('file', createReadStream(localPath));
    return this._post(`/api/ecode/resource/upload?folderId=${folderId}`, form, form.getHeaders());
  }

  _buildUrl(path: string, params?: Params): string {
    const base = this.baseUrl.replace(/\/$/, '');
    const url = new URL(base + path);
    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  _buildFetchOptions(options: RequestOptions): { headers: Record<string, string>; body?: BodyInit } {
    const headers = { ...(options.headers || {}) };
    let body = options.body;

    if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof URLSearchParams)) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body as Params)) {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      }
      body = params;
      headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
    }

    const cookieString = this.jar.getCookieString();
    if (cookieString) {
      headers.Cookie = cookieString;
    }

    return { headers, body: body as BodyInit | undefined };
  }

  _isSessionExpired(resData: unknown): boolean {
    // E9 会话过期通常通过 msgcode=-1 或特定字段标识
    if (!isRecord(resData)) return false;
    const code = resData.errorCode;
    return code === '002' && resData.msg === '登录信息超时';
  }

  _throwIfApiFailed(resData: unknown): void {
    if (!isRecord(resData) || resData.api_status !== false) return;
    throw new Error(typeof resData.msg === 'string' && resData.msg ? resData.msg : 'Request failed');
  }

  async _request(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = this._buildUrl(path, options.params);
    const { headers, body } = this._buildFetchOptions(options);
    const method = options.method || 'GET';

    // 没有 cookie 时先登录
    if (!this.jar.getCookieString()) {
      await this.login();
      headers.Cookie = this.jar.getCookieString();
    }

    this.logger.logRequest(method, url, headers);
    const t0 = Date.now();

    const res = await fetch(url, { method, headers, body });
    const duration = Date.now() - t0;

    // 检测会话失效：克隆 response 以便正文可二次读取
    const cloned = res.clone();
    try {
      const resData = await cloned.json();
      this.logger.logResponse(method, url, res.status, resData, duration);
      this._throwIfApiFailed(resData);

      if (this._isSessionExpired(resData)) {
        this.logger.logSessionExpired(url);
        await this.login();
        // 用新 cookie 重试一次
        const { headers: retryHeaders, body: retryBody } = this._buildFetchOptions(options);
        this.logger.logRequest(method, url, retryHeaders);
        const t1 = Date.now();
        const retryRes = await fetch(url, { method, headers: retryHeaders, body: retryBody });
        const retryCloned = retryRes.clone();
        try {
          const retryData = await retryCloned.json();
          this.logger.logResponse(method, url, retryRes.status, retryData, Date.now() - t1);
        } catch {
          this.logger.logResponse(method, url, retryRes.status, null, Date.now() - t1);
        }
        return retryRes;
      }
    } catch {
      // 非 JSON 响应（如文件下载），记录基本信息即可
      this.logger.logResponse(method, url, res.status, null, duration);
    }

    return res;
  }

  async _get(path: string, params?: Params, headers?: Record<string, string>): Promise<Response> {
    return this._request(path, { method: 'GET', params, headers });
  }

  async _post(path: string, body?: RequestBody, headers?: Record<string, string>): Promise<Response> {
    return this._request(path, { method: 'POST', body, headers });
  }
}
