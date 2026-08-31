export function removeUseStrict(source: string): string {
  return source.replace(/^\s*["']use strict["'];\s*/, '');
}

export function applyAppId(source: string, appId: string): string {
  return source.replace(/\\?\$\{appId\}/g, appId);
}

export function appendSourceComment(source: string, sourcePath: string): string {
  return `${source}\n/*\n路径：\n${sourcePath}\n*/\n`;
}

export function wrapJavaScript(source: string): string {
  return `(function(){\n${source}\n})();`;
}
