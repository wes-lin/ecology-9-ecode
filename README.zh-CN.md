# Weaver Ecology eCode 开发助手

[English](./README.md) | 简体中文

面向泛微 Weaver Ecology 9 eCode 开发的 pnpm monorepo，包含可复用的 API SDK、本地编译与代理运行时，以及集成这两个包的 VS Code 插件。

## 工作区包

| 包                  | 说明                                     | 文档                                                                                                     |
| ------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ecode-sdk`         | API 访问、项目同步、应用打包与发布。     | [English](./packages/ecode-sdk/README.md) · [中文](./packages/ecode-sdk/README.zh-CN.md)                 |
| `ecode-dev-runtime` | 本地编译、增量重建、文件监听与反向代理。 | [English](./packages/ecode-dev-runtime/README.md) · [中文](./packages/ecode-dev-runtime/README.zh-CN.md) |
| `vscode-ecode`      | 在 VS Code 中进行本地和远程 eCode 开发。 | [English](./packages/vscode-ecode/README.md) · [中文](./packages/vscode-ecode/README.zh-CN.md)           |

## 环境要求

- Node.js 22 或更高版本
- pnpm 10.15.0
- 开发插件时需要 VS Code 1.83.0 或更高版本

## 仓库开发

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

调试插件时，使用 VS Code 打开仓库，选择 `Run Extension (vscode-ecode)` 调试配置并按 `F5`。

## 发布

`.github/workflows/release.yml` 提供手动发布流程，可以选择发布 `ecode-sdk`、`ecode-dev-runtime`、VS Code 插件或全部目标。各包的构建与使用方式请查看对应包 README。
