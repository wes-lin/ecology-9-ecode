# ecode-dev-runtime

[English](./README.md) | [简体中文](./README.zh-CN.md)

Reusable local build, watch, and reverse-proxy runtime for Ecology 9 eCode projects. It has no VS Code dependency, so the same implementation can be embedded in the `vscode-ecode` extension or invoked from a command line.

## Installation

```bash
npm install ecode-dev-runtime
```

## Project contract

The runtime reads:

- `<projectRoot>/.ecode/apps/*.json`
- `<projectRoot>/.ecode/ecode-tree.json`
- `<projectRoot>/src/**`

It owns only these output directories:

- `<projectRoot>/dist/dev`
- `<projectRoot>/dist/release`

Other directories under `dist`, such as `dist/app-upgrade`, are preserved.

Only apps with `appStatus: "released"` and `debugMode !== "y"` are built.

## Programmatic API

```ts
import { createEcodeDevRuntime } from 'ecode-dev-runtime';

const runtime = createEcodeDevRuntime({
  projectRoot: '/workspace/ecode-project',
  proxyTarget: 'https://ecology.example.com',
  host: '127.0.0.1',
  port: 9090,
  logger,
});

const address = await runtime.start();
console.log(address.url);

await runtime.rebuildFile('/workspace/ecode-project/src/Type/App/index.js');
await runtime.dispose();
```

The main APIs are:

- `build()` performs a clean build of `dist/dev` and `dist/release`.
- `prepare()` reuses valid output or incrementally rebuilds source changes since the previous session.
- `rebuildFile(path)` routes the change to the owning app's JavaScript, CSS, resource, or pre-state task.
- `rebuildFiles(paths)` groups a change batch by output target and rebuilds independent targets in parallel.
- `reloadConfiguration()` reloads `.ecode/apps` and performs a clean build.
- `startWatching()` and `stopWatching()` manage the built-in Node watcher.
- `startProxy()` and `stopProxy()` manage the local reverse proxy.
- `start()` prepares the build output, starts watching, and starts the proxy.
- `dispose()` stops all resources, waits for queued builds, and persists the reusable build state.

The VS Code extension can use its own `FileSystemWatcher` and call `rebuildFile` or `reloadConfiguration`; it does not need to use the built-in watcher.

Debug startup stores reusable file signatures, output signatures, and compiled pre-state fragments in `dist/.ecode-dev-runtime/build-state.json`. A later `prepare()` skips compilation when the metadata, sources, runtime assets, and output are unchanged. Source changes made between sessions are sent through the normal incremental rebuild pipeline; incompatible metadata, missing output, or an incompatible cache falls back to a clean build. `dist` remains ignored by Git.

During a watch session, released app metadata, app path lookup, the eCode tree, per-app tree ordering, and compiled pre-state fragments are cached. Changes collected in one debounce window are grouped so that each app output is built once while independent JavaScript, CSS, resource, and pre-state targets run in parallel. A pre-state batch recompiles only its changed fragments before writing `init.js` or `init.css` once. Changing `.ecode/apps` or `ecode-tree.json` clears the session caches and performs a clean build.

## Pre-state base JavaScript

The runtime owns and versions the two base scripts used to generate `dist/dev/init.js`:

```text
assets/ecode/ecode-sdk.js
assets/ecode/wea.js
```

Their version and SHA-256 checksums are exported as `BUNDLED_ECODE_ASSET_VERSION` and `BUNDLED_ECODE_ASSETS`. They are used automatically when `preStateBaseJavaScriptFiles` is omitted.

Callers can pass `preStateBaseJavaScriptFiles` to override the bundled assets, or an empty array to disable them. A caller that bundles the runtime into one JavaScript file, such as the VS Code extension, must copy `assets/ecode` into its extension artifact or pass the copied asset paths explicitly.

## Proxy behavior

The proxy serves these paths from local build output:

- `/cloudstore/dev/init.js`
- `/cloudstore/dev/init.css`
- `/cloudstore/release/**`

All other HTTP and WebSocket traffic is forwarded to `proxyTarget`. The server binds to `127.0.0.1` by default, rewrites upstream redirects to the local origin, and removes upstream cookie `Domain` attributes so authenticated browser sessions can work through the local origin.

## CLI

```bash
ecode-dev build --project .
ecode-dev watch --project .
ecode-dev start --project . --target https://ecology.example.com --port 9090
ecode-dev proxy --project . --target https://ecology.example.com
```

`ECODE_PROXY_TARGET` can be used instead of `--target`. Use `--allow-insecure` only for a trusted development server with a self-signed TLS certificate.

## Development

From the repository root:

```bash
pnpm --filter ecode-dev-runtime build
pnpm --filter ecode-dev-runtime test
```
