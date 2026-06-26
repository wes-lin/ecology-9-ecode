# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install dependencies: `pnpm install`
- Build all packages: `pnpm build`
- Build SDK only: `pnpm --filter ecode-sdk build`
- Build VS Code extension only: `pnpm --filter vscode-ecode build`
- Production-build VS Code extension: `pnpm --filter vscode-ecode build:production`
- Package VS Code extension VSIX: `pnpm --filter vscode-ecode package`
- Run all tests: `pnpm test`
- Run SDK tests: `pnpm --filter ecode-sdk test`
- Run a single SDK test file after building: `pnpm --filter ecode-sdk build; node --test packages/ecode-sdk/test/client.test.js`
- Lint: `pnpm lint`
- Fix lint issues: `pnpm lint:fix`
- Format: `pnpm format`
- Check formatting: `pnpm format:check`

## Architecture

This is a pnpm workspace TypeScript monorepo for an Ecology 9 ecode local development assistant.

- `packages/ecode-sdk` is the reusable Node SDK. `src/client.ts` contains `EcodeClient` and `CookieJar`, handles RSA login, session cookies, automatic login/re-login, tree listing, remote file viewing, upload, and download calls. `src/logger.ts` contains `EcodeLogger` and `NOOP_LOGGER`; sensitive request data is redacted by default.
- `packages/vscode-ecode` is the VS Code extension. `src/extension.ts` wires VS Code commands and creates the `ecodeExplorer` tree view. `src/providers/treeDataProvider.ts` owns most extension behavior: reads `ecode.*` settings, creates the SDK client, maps remote tree items into `EcodeNode`s, downloads remote source into the configured local directory, opens local files, shows remote files through the virtual filesystem, and compares remote vs local content. `src/providers/fileSystemProvider.ts` implements the read-only `ecode:` virtual filesystem backed by tree data and cached file contents.
- The extension imports `ecode-sdk` via a TypeScript path in `packages/vscode-ecode/tsconfig.json`; the esbuild bundler also aliases `ecode-sdk` to `../ecode-sdk/src/index.ts`, so extension builds bundle SDK source directly.
- Root `tsconfig.json` uses project references for the two packages. `packages/ecode-sdk` is composite and emits declarations into `dist`; `packages/vscode-ecode` is type-checked with `noEmit` and built by `esbuild.js` into `dist/extension.js`.

## Development notes

- Node >=22 is declared at the repo root; the SDK itself declares Node >=18 and uses global `fetch` plus `form-data` for uploads.
- SDK tests are CommonJS `node:test` files in `packages/ecode-sdk/test` and import from `packages/ecode-sdk/dist`, so build the SDK before running an individual test file.
- Root linting uses ESLint flat config with TypeScript ESLint and Prettier. `dist`, `out`, and `node_modules` are ignored.
- VS Code extension settings are contributed under `ecode.baseUrl`, `ecode.username`, `ecode.password`, and `ecode.localDir`; the extension refreshes when these settings change.
- `ecode.localDir` defaults to `src`. Download and open-local-file flows validate remote paths before writing under that local root.
- The delete command currently prompts only for nodes marked deletable and then reports that deletion is not implemented.
