# ecode-dev-assistant

A monorepo for local development assistant for 泛微 Ecology 9 ecode.

## Packages

- `packages/ecode-sdk` — JavaScript SDK for ecode API (login, upload, download, tree).
- `packages/ecode-dev-runtime` — Reusable local builder, incremental watcher, and reverse proxy for ecode projects.
- `packages/vscode-ecode` — VS Code extension that uses `ecode-sdk` and `ecode-dev-runtime` for remote and local ecode development.

## Development

```bash
npm install
npm run build
```
