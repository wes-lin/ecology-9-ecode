import * as path from 'node:path';

export const BUNDLED_ECODE_ASSET_VERSION = '1';

export const BUNDLED_ECODE_ASSETS = [
  {
    name: 'ecode-sdk.js',
    sha256: 'fbc1a1aeab447a8397c0d257a1bce5a96a5b70abf7ea9e0aeb46266aa5e76f06',
  },
  {
    name: 'wea.js',
    sha256: 'a9d1a1c5a265d7ce84c2b6c44d53f7d4b3601d66123380240385abb56dad6a30',
  },
] as const;

/**
 * Resolve the versioned pre-state assets shipped with this package.
 *
 * Callers that bundle the runtime into a single file should copy assets/ecode
 * beside the bundle or pass explicit preStateBaseJavaScriptFiles paths.
 */
export function getBundledPreStateBaseJavaScriptFiles(): string[] {
  const assetDirectory = path.resolve(__dirname, '..', 'assets', 'ecode');
  return BUNDLED_ECODE_ASSETS.map((asset) => path.join(assetDirectory, asset.name));
}
