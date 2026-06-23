const { appendFileSync, existsSync, mkdirSync } = require('fs');
const { dirname } = require('path');

// ─── 日志级别定义 ────────────────────────────────────────────────────────────
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

// 控制台颜色（ANSI，不支持颜色的终端会原样显示但不影响逻辑）
const COLORS = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
  reset: '\x1b[0m',
};

// 需要脱敏的字段名（小写匹配）
const SENSITIVE_KEYS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'userpassword',
  'password',
  'loginid',
]);

/**
 * EcodeLogger — 轻量请求/响应日志工具
 *
 * @example
 * const logger = new EcodeLogger({ level: 'debug', file: './ecode.log' });
 * // 或在 EcodeClient 中通过 options.logger 传入
 */
class EcodeLogger {
  /**
   * @param {object}  [options]
   * @param {'debug'|'info'|'warn'|'error'|'silent'} [options.level='info']
   *   最低输出级别。低于此级别的日志会被忽略。
   * @param {boolean} [options.console=true]   是否输出到控制台
   * @param {string}  [options.file]           日志文件路径（追加写入，undefined 则不写文件）
   * @param {boolean} [options.colors=true]    控制台是否使用 ANSI 颜色
   * @param {boolean} [options.redact=true]    是否自动脱敏敏感字段
   */
  constructor(options = {}) {
    this.level = LEVELS[options.level] ?? LEVELS.info;
    this.useConsole = options.console !== false;
    this.filePath = options.file || null;
    this.useColors = options.colors !== false;
    this.redact = options.redact !== false;

    if (this.filePath) {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  // ── 公共日志方法 ──────────────────────────────────────────────────────────

  debug(message, data) { this._write('debug', message, data); }
  info(message, data)  { this._write('info',  message, data); }
  warn(message, data)  { this._write('warn',  message, data); }
  error(message, data) { this._write('error', message, data); }

  /**
   * 记录请求信息（在 _request 发出 fetch 前调用）
   * @param {string} method
   * @param {string} url
   * @param {object} [headers]
   */
  logRequest(method, url, headers) {
    if (this.level > LEVELS.debug) return;
    this._write('debug', `→ ${method} ${url}`, {
      headers: this._redactHeaders(headers),
    });
  }

  /**
   * 记录响应信息（在拿到 response 后调用）
   * @param {string} method
   * @param {string} url
   * @param {number} status
   * @param {object|string|null} [body]  已解析的响应体（可选）
   * @param {number} [durationMs]        请求耗时（毫秒）
   */
  logResponse(method, url, status, body, durationMs) {
    const level = status >= 400 ? 'warn' : 'debug';
    if (this.level > LEVELS[level]) return;

    const suffix = durationMs != null ? ` (${durationMs}ms)` : '';
    this._write(level, `← ${status} ${method} ${url}${suffix}`, {
      body: this._redactBody(body),
    });
  }

  /**
   * 记录会话过期 + 自动重登录事件
   * @param {string} url
   */
  logSessionExpired(url) {
    this._write('warn', `Session expired on ${url}, re-logging in…`);
  }

  // ── 内部工具 ──────────────────────────────────────────────────────────────

  _write(level, message, data) {
    if (LEVELS[level] < this.level) return;

    const ts = new Date().toISOString();
    const tag = `[${level.toUpperCase()}]`.padEnd(7);
    const plain = `${ts} ${tag} ${message}`;
    const detail = data != null ? `\n${JSON.stringify(data, null, 2)}` : '';

    if (this.useConsole) {
      const color = this.useColors ? (COLORS[level] || '') : '';
      const reset = this.useColors ? COLORS.reset : '';
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(`${color}${plain}${reset}${detail}`);
    }

    if (this.filePath) {
      try {
        appendFileSync(this.filePath, plain + detail + '\n', 'utf-8');
      } catch {
        // 文件写入失败时静默，避免影响主流程
      }
    }
  }

  /**
   * 对 headers 对象中的敏感字段做脱敏
   * @param {object} [headers]
   * @returns {object|undefined}
   */
  _redactHeaders(headers) {
    if (!headers || !this.redact) return headers;
    const result = {};
    for (const [k, v] of Object.entries(headers)) {
      result[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
    }
    return result;
  }

  /**
   * 对响应体中的敏感字段做脱敏
   * @param {*} body
   * @returns {*}
   */
  _redactBody(body) {
    if (!body || !this.redact || typeof body !== 'object') return body;
    const result = {};
    for (const [k, v] of Object.entries(body)) {
      result[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
    }
    return result;
  }
}

/**
 * 空操作 Logger，在不需要日志时作为默认值，避免满处做 null 检查
 */
const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  logRequest: () => {},
  logResponse: () => {},
  logSessionExpired: () => {},
};

module.exports = { EcodeLogger, NOOP_LOGGER, LEVELS };
