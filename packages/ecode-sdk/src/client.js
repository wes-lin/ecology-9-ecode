const { createReadStream } = require('fs');
const { URL } = require('url');
const FormData = require('form-data');

class EcodeClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost';
    this.username = options.username || '';
    this.password = options.password || '';
    this.session = null;
  }

  async login() {
    const res = await this._post('/api/ecode/login', {
      loginid: this.username,
      password: this.password,
    });

    if (res.status !== 200) {
      throw new Error(`Login failed: HTTP ${res.status}`);
    }

    let data;
    try {
      data = JSON.parse(res.text);
    } catch {
      data = { raw: res.text };
    }

    if (!data || data.status !== 'success') {
      throw new Error(`Login failed: ${data?.message || res.text}`);
    }

    this.session = data.session || data.token || data;
    return this.session;
  }

  async listTree(path = '/') {
    this._ensureAuth();
    const res = await this._post('/api/ecode/tree', {
      path,
      session: this.session,
    });
    this._assertOk(res);
    return this._parseJson(res);
  }

  async uploadFile(localPath, remotePath) {
    this._ensureAuth();
    const form = new FormData();
    form.append('session', this.session);
    form.append('path', remotePath);
    form.append('file', createReadStream(localPath));

    const res = await this._post('/api/ecode/upload', form, form.getHeaders());
    this._assertOk(res);
    return this._parseJson(res);
  }

  async downloadFile(remotePath) {
    this._ensureAuth();
    const res = await this._post('/api/ecode/download', {
      path: remotePath,
      session: this.session,
    });
    this._assertOk(res);
    return res.raw;
  }

  async _request(path, options = {}) {
    const url = new URL(this.baseUrl.replace(/\/$/, '') + path).toString();
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

    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body,
    });

    const arrayBuffer = await res.arrayBuffer();
    const raw = Buffer.from(arrayBuffer);

    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      raw,
      text: raw.toString('utf-8'),
    };
  }

  async _get(path, headers) {
    return this._request(path, { method: 'GET', headers });
  }

  async _post(path, body, headers) {
    return this._request(path, { method: 'POST', body, headers });
  }

  _ensureAuth() {
    if (!this.session) {
      throw new Error('Not logged in. Call login() first.');
    }
  }

  _assertOk(res) {
    if (res.status >= 400) {
      throw new Error(`Ecode API error: HTTP ${res.status} - ${res.text}`);
    }
  }

  _parseJson(res) {
    try {
      return JSON.parse(res.text);
    } catch (err) {
      throw new Error(`Invalid JSON response: ${err.message}`);
    }
  }
}

module.exports = { EcodeClient };
