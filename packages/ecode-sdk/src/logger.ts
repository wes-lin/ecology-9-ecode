import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── 日志级别定义 ────────────────────────────────────────────────────────────
export const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const;

// 控制台颜色（ANSI，不支持颜色的终端会原样显示但不影响逻辑）
const COLORS = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red,
  reset: '\x1b[0m',
} as const;

// 需要脱敏的字段名（小写匹配）
const SENSITIVE_KEYS = new Set(['cookie', 'set-cookie', 'authorization', 'userpassword', 'password', 'loginid']);

export type LogLevel = keyof typeof LEVELS;

export type EcodeLoggerOptions = {
  level?: LogLevel;
  console?: boolean;
  file?: string;
  colors?: boolean;
  redact?: boolean;
};

export type EcodeLoggerLike = {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  logRequest(method: string, url: string, headers?: Record<string, unknown>): void;
  logResponse(method: string, url: string, status: number, body?: unknown, durationMs?: number): void;
  logSessionExpired(url: string): void;
};

/**
 * EcodeLogger — 轻量请求/响应日志工具
 *
 * @example
 * const logger = new EcodeLogger({ level: 'debug', file: './ecode.log' });
 * // 或在 EcodeClient 中通过 options.logger 传入
 */
export class EcodeLogger implements EcodeLoggerLike {
  level: number;
  useConsole: boolean;
  filePath: string | null;
  useColors: boolean;
  redact: boolean;

  /**
   * @param options
   * @param options.level 最低输出级别。低于此级别的日志会被忽略。
   * @param options.console 是否输出到控制台
   * @param options.file 日志文件路径（追加写入，undefined 则不写文件）
   * @param options.colors 控制台是否使用 ANSI 颜色
   * @param options.redact 是否自动脱敏敏感字段
   */
  constructor(options: EcodeLoggerOptions = {}) {
    this.level = LEVELS[options.level ?? 'info'];
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

  debug(message: string, data?: unknown): void {
    this._write('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this._write('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this._write('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this._write('error', message, data);
  }

  /**
   * 记录请求信息（在 _request 发出 fetch 前调用）
   * @param method
   * @param url
   * @param headers
   */
  logRequest(method: string, url: string, headers?: Record<string, unknown>): void {
    if (this.level > LEVELS.debug) return;
    this._write('debug', `→ ${method} ${url}`, {
      headers: this._redactHeaders(headers),
    });
  }

  /**
   * 记录响应信息（在拿到 response 后调用）
   * @param method
   * @param url
   * @param status
   * @param body 已解析的响应体（可选）
   * @param durationMs 请求耗时（毫秒）
   */
  logResponse(method: string, url: string, status: number, body?: unknown, durationMs?: number): void {
    const level: Exclude<LogLevel, 'info' | 'silent'> = status >= 400 ? 'warn' : 'debug';
    if (this.level > LEVELS[level]) return;

    const suffix = durationMs != null ? ` (${durationMs}ms)` : '';
    this._write(level, `← ${status} ${method} ${url}${suffix}`, {
      body: this._redactBody(body),
    });
  }

  /**
   * 记录会话过期 + 自动重登录事件
   * @param url
   */
  logSessionExpired(url: string): void {
    this._write('warn', `Session expired on ${url}, re-logging in…`);
  }

  // ── 内部工具 ──────────────────────────────────────────────────────────────

  _write(level: LogLevel, message: string, data?: unknown): void {
    if (LEVELS[level] < this.level) return;

    const ts = new Date().toISOString();
    const tag = `[${level.toUpperCase()}]`.padEnd(7);
    const plain = `${ts} ${tag} ${message}`;
    const detail = data != null ? `\n${JSON.stringify(data, null, 2)}` : '';

    if (this.useConsole) {
      const color = this.useColors ? COLORS[level as keyof typeof COLORS] || '' : '';
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
   * @param headers
   * @returns 脱敏后的 headers
   */
  _redactHeaders<T extends Record<string, unknown> | undefined>(headers: T): T | Record<string, unknown> {
    if (!headers || !this.redact) return headers;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(headers)) {
      result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : value;
    }
    return result;
  }

  /**
   * 对响应体中的敏感字段做脱敏
   * @param body
   * @returns 脱敏后的响应体
   */
  _redactBody(body: unknown): unknown {
    if (!body || !this.redact || typeof body !== 'object') return body;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : value;
    }
    return result;
  }
}

/**
 * 空操作 Logger，在不需要日志时作为默认值，避免满处做 null 检查
 */
export const NOOP_LOGGER: EcodeLoggerLike = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  logRequest: () => {},
  logResponse: () => {},
  logSessionExpired: () => {},
};
