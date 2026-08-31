# Weaver Ecology eCode Dev Assistant

English | [简体中文](./README.zh-CN.md)

A pnpm monorepo for Weaver Ecology 9 eCode development. It contains a reusable API SDK, a local build and proxy runtime, and a VS Code extension that integrates both packages.

## Packages

| Package             | Description                                                              | Documentation                                                                                            |
| ------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `ecode-sdk`         | API access, project synchronization, app packaging, and publishing.      | [English](./packages/ecode-sdk/README.md) · [中文](./packages/ecode-sdk/README.zh-CN.md)                 |
| `ecode-dev-runtime` | Local builds, incremental rebuilds, file watching, and reverse proxying. | [English](./packages/ecode-dev-runtime/README.md) · [中文](./packages/ecode-dev-runtime/README.zh-CN.md) |
| `vscode-ecode`      | Local and remote eCode development in VS Code.                           | [English](./packages/vscode-ecode/README.md) · [中文](./packages/vscode-ecode/README.zh-CN.md)           |

## Requirements

- Node.js 22 or later
- pnpm 10.15.0
- VS Code 1.83.0 or later for extension development

## Repository Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

To debug the extension, open the repository in VS Code, select `Run Extension (vscode-ecode)`, and press `F5`.

## Releases

The manual release workflow in `.github/workflows/release.yml` can publish `ecode-sdk`, `ecode-dev-runtime`, the VS Code plugin, or all three targets. See each package README for package-specific build and usage instructions.
