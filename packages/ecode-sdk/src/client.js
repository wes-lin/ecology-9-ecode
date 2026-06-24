const { createReadStream, readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { dirname } = require('path');
const { URL } = require('url');
const FormData = require('form-data');
const crypto = require('crypto');
const { EcodeLogger, NOOP_LOGGER } = require('./logger.js');

/**
 * 将裸 base64 公钥字符串包装为合法 PEM 格式（每 64 字符换行）
 * @param {string} pubKey  纯 base64 公钥内容（不含 PEM 头尾）
 * @returns {string}  合法的 PEM 字符串
 */
function wrapPem(pubKey) {
  // 去掉可能已有的换行和头尾标记，取纯 base64
  const raw = pubKey
    .replace(/-----BEGIN[^-]+-----/g, '')
    .replace(/-----END[^-]+-----/g, '')
    .replace(/[\s\r\n]/g, '');

  const lines = [];
  for (let i = 0; i < raw.length; i += 64) {
    lines.push(raw.substring(i, i + 64));
  }
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

/**
 * RSA 加密（PKCS#1 v1.5 padding，与 JSEncrypt 行为一致）
 * @param {string} pubKey  纯 base64 公钥或完整 PEM
 * @param {string} content  待加密明文
 * @returns {string}  base64 编码的密文
 */
function rsaEncrypt(pubKey, content) {
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

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setCookie(setCookieHeader) {
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

  getCookieString() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  loadFromFile(filePath) {
    if (!filePath || !existsSync(filePath)) return;
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      if (data && typeof data === 'object') {
        for (const [name, value] of Object.entries(data)) {
          this.cookies.set(name, value);
        }
      }
    } catch {
      // ignore invalid cookie file
    }
  }

  saveToFile(filePath) {
    if (!filePath) return;
    const data = Object.fromEntries(this.cookies.entries());
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  clear() {
    this.cookies.clear();
  }
}

class EcodeClient {
  /**
   * @param {object}  [options]
   * @param {string}  [options.baseUrl]
   * @param {string}  [options.username]
   * @param {string}  [options.password]
   * @param {string}  [options.cookieFile]
   * @param {EcodeLogger|object} [options.logger]
   *   传入已实例化的 EcodeLogger，或一个符合相同接口的对象。
   *   也可以传入 { level, file, console, colors, redact } 配置对象，
   *   SDK 会自动构造 EcodeLogger。
   *   不传则静默（不打印任何日志）。
   */
  constructor(options = {}) {
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
    } else if (loggerOpt instanceof EcodeLogger || typeof loggerOpt.logRequest === 'function') {
      // 已是 logger 实例或自定义兼容对象，直接使用
      this.logger = loggerOpt;
    } else {
      // 将 options.logger 作为 EcodeLogger 的配置项构造
      this.logger = new EcodeLogger(loggerOpt);
    }
  }

  isLoggedIn() {
    return !!this.jar.getCookieString();
  }

  getRsaInfo() {
    return fetch(`${this.baseUrl}/rsa/weaver.rsa.GetRsaInfo`).then((res) => res.json());
  }

  encryptWithRsa(rsaInfo, text) {
    const { rsa_pub, rsa_code, rsa_flag } = rsaInfo;
    let data = null;
    const groupLength = 240;
    if (text.length > groupLength) {
      //需要分段加密
      data = '';
      const length = text.length;
      const groups = Math.floor(length / groupLength) + 1;
      for (let i = 0; i < groups; i++) {
        let v = '';
        if (i != groups - 1) {
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

  async login() {
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
    const resData = await res.json();

    if (resData.msgcode === '0') {
      this.logger.info('Login successful');
    } else {
      this.logger.error('Login rejected by server', { msgcode: resData.msgcode, msg: resData.msg });
      throw new Error(`${resData.msg}`);
    }

    this.jar.clear();
    this.jar.setCookie(res.headers.getSetCookie());

    if (!this.jar.getCookieString()) {
      throw new Error('Login succeeded but server did not set a session cookie.');
    }

    this.jar.saveToFile(this.cookieFile);
    return resData;
  }

  async logout() {
    this.logger.info('Logging out');
    this.jar.clear();
    if (this.cookieFile) {
      this.jar.saveToFile(this.cookieFile);
    }
  }

  async listTree(folderId = '', typeId = '') {
    const res = await this._get('/api/ecode/type/tree', { folderId, typeId });
    const treeData = await res.json();
    return [].concat(
      treeData.system || [],
      treeData.typeList || [],
      treeData.childFolder || [],
      treeData.childFile || []
    );
  }

  async viewFile(id) {
    const res = await this._get('/api/cloudstore/ecode/one', { id });
    const resData = await res.json();
    return resData.data.content;
  }

  async uploadFile(localPath, remotePath) {
    const form = new FormData();
    form.append('path', remotePath);
    form.append('file', createReadStream(localPath));
    const res = await this._post('/api/ecode/upload', form, form.getHeaders());
    // return this._parseJson(res);
    return res;
  }

  async downloadFile(remotePath) {
    const res = await this._post('/api/ecode/download', { path: remotePath });
    if (!res.ok) {
      throw new Error(`Download failed: HTTP ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  _buildUrl(path, params) {
    const base = this.baseUrl.replace(/\/$/, '');
    const url = new URL(base + path);
    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, value);
        }
      }
    }
    return url.toString();
  }

  _buildFetchOptions(options) {
    const headers = { ...options.headers };
    let body = options.body;

    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        params.append(key, value);
      }
      body = params;
      headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
    }

    const cookieString = this.jar.getCookieString();
    if (cookieString) {
      headers['Cookie'] = cookieString;
    }

    return { headers, body };
  }

  _isSessionExpired(resData) {
    // E9 会话过期通常通过 msgcode=-1 或特定字段标识
    if (!resData || typeof resData !== 'object') return false;
    const code = resData.errorCode;
    return code === '002' && resData.msg === '登录信息超时';
  }

  async _request(path, options = {}) {
    const url = this._buildUrl(path, options.params);
    const { headers, body } = this._buildFetchOptions(options);
    const method = options.method || 'GET';

    // 没有 cookie 时先登录
    if (!this.jar.getCookieString()) {
      await this.login();
      headers['Cookie'] = this.jar.getCookieString();
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

  async _get(path, params, headers) {
    return this._request(path, { method: 'GET', params, headers });
  }

  async _post(path, body, headers) {
    return this._request(path, { method: 'POST', body, headers });
  }
}

module.exports = { EcodeClient, CookieJar };
