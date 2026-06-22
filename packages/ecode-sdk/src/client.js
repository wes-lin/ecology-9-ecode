const { createReadStream, readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { dirname } = require('path');
const { JSEncrypt } = require('jsencrypt');
const { URL } = require('url');
const FormData = require('form-data');

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
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost';
    this.username = options.username || '';
    this.password = options.password || '';
    this.cookieFile = options.cookieFile || null;
    this.jar = new CookieJar();
    this.jar.loadFromFile(this.cookieFile);
  }

  isLoggedIn() {
    return !!this.jar.getCookieString();
  }

  getRsaInfo() {
    return fetch(`${this.baseUrl}/rsa/weaver.rsa.GetRsaInfo`).then((res) => res.json());
  }

  encryptWithRsa(rsaInfo, text) {
    const encrypt = new JSEncrypt();
    const { rsa_pub, rsa_code, rsa_flag } = rsaInfo;
    encrypt.setPublicKey(rsa_pub);
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
          data += encrypt.encrypt(v + rsa_code) + rsa_flag;
        }
      }
    } else {
      data = encrypt.encrypt(text + rsa_code) + rsa_flag;
    }
    return data;
  }

  async login() {
    const rsaInfo = await this.getRsaInfo();
    const encryptedLoginId = this.encryptWithRsa(rsaInfo, this.username);
    const encryptedPassword = this.encryptWithRsa(rsaInfo, this.password);

    const body = {
      islanguid: '7',
      loginid: encryptedLoginId,
      userpassword: encryptedPassword,
      logintype: '1',
      isie: false,
    };
    const res = await this._post('/api/hrm/login/checkLogin', body);
    if (res.status !== 200) {
      throw new Error(`Login failed: HTTP ${res.status}`);
    }
    const resData = await res.json();
    if (resData.msgcode === '0') {
      console.log('Login successful');
    } else {
      throw new Error(`${resData.msg}`);
    }

    this.jar.setCookie(res.headers.getSetCookie());

    if (!this.jar.getCookieString()) {
      throw new Error('Login succeeded but server did not set a session cookie.');
    }

    this.jar.saveToFile(this.cookieFile);
    return resData;
  }

  async logout() {
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
    // return res.raw;
    return res;
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

  _request(path, options = {}) {
    const url = this._buildUrl(path, options.params);
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

    return fetch(url, {
      method: options.method || 'GET',
      headers,
      body,
    });
  }

  async _get(path, params, headers) {
    return this._request(path, { method: 'GET', params, headers });
  }

  async _post(path, body, headers) {
    return this._request(path, { method: 'POST', body, headers });
  }
}

module.exports = { EcodeClient, CookieJar };
