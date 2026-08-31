# ecode-dev-runtime

[English](./README.md) | 简体中文

面向泛微 Weaver Ecology 9 eCode 项目的本地编译、增量监听和反向代理运行时。它不依赖 VS Code，可以嵌入 `vscode-ecode` 插件，也可以通过代码或命令行独立使用。

## 安装

```bash
npm install ecode-dev-runtime
```

需要 Node.js 22 或更高版本。

## 项目约定

运行时读取：

- `<projectRoot>/.ecode/apps/*.json`
- `<projectRoot>/.ecode/ecode-tree.json`
- `<projectRoot>/src/**`

运行时只维护以下输出：

- `<projectRoot>/dist/dev`
- `<projectRoot>/dist/release`
- `<projectRoot>/dist/.ecode-dev-runtime/build-state.json`

`dist` 下的其他目录会被保留，例如 CI/CD 使用的 `dist/app-upgrade`。只有 `appStatus: "released"` 且 `debugMode !== "y"` 的应用会参与编译。

## 代码调用

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

主要 API：

- `build()`：清理并完整构建 `dist/dev` 和 `dist/release`。
- `prepare()`：复用有效输出，或增量处理两次运行之间发生变化的源文件。
- `rebuildFile(path)`：将一个文件变化路由到所属应用的 JavaScript、CSS、资源或前置加载任务。
- `rebuildFiles(paths)`：按输出目标合并一批变化，并行执行相互独立的任务。
- `reloadConfiguration()`：重新读取 `.ecode/apps` 并执行完整构建。
- `startWatching()` / `stopWatching()`：控制内置 Node 文件监听器。
- `startProxy()` / `stopProxy()`：控制本地反向代理。
- `start()`：准备输出，然后启动监听和代理。
- `dispose()`：停止资源、等待构建队列完成并持久化构建状态。

VS Code 等集成方可以使用自己的文件监听器，然后调用 `rebuildFile` 或 `reloadConfiguration`，不必启用 runtime 内置监听器。

## 增量构建与缓存

运行时将文件签名、输出签名和已编译的前置加载片段保存在 `dist/.ecode-dev-runtime/build-state.json`。

- 元数据、源文件、runtime 资源和输出均未变化时，`prepare()` 会跳过编译。
- 调试停止期间发生的源文件变化，会在下一次启动时进入正常的增量编译流程。
- 元数据变化、输出缺失或缓存版本不兼容时，会自动回退到完整构建。
- 一个防抖窗口内的变化会按输出目标合并，避免同一应用重复编译。
- JavaScript、CSS、资源和前置加载等独立目标可以并行执行。
- 修改前置加载文件时只重新编译变化片段，再统一写入 `init.js` 或 `init.css`。

## 内置基础脚本

runtime 自带生成 `dist/dev/init.js` 所需的两个版本化脚本：

```text
assets/ecode/ecode-sdk.js
assets/ecode/wea.js
```

版本和 SHA-256 校验信息通过 `BUNDLED_ECODE_ASSET_VERSION` 与 `BUNDLED_ECODE_ASSETS` 导出。默认自动使用这些资源；调用方可以通过 `preStateBaseJavaScriptFiles` 覆盖，或传入空数组禁用。

如果调用方将 runtime 打包到单个 JavaScript 文件中，还需要把 `assets/ecode` 复制到最终产物，或显式传入复制后的资源路径。

## 代理行为

以下请求直接使用本地编译输出：

- `/cloudstore/dev/init.js`
- `/cloudstore/dev/init.css`
- `/cloudstore/release/**`

其他 HTTP 和 WebSocket 请求转发到 `proxyTarget`。服务默认监听 `127.0.0.1`，会把上游重定向改写到本地地址，并移除上游 Cookie 的 `Domain` 属性，使登录会话可以通过本地域名工作。

## 命令行

```bash
ecode-dev build --project .
ecode-dev watch --project .
ecode-dev start --project . --target https://ecology.example.com --port 9090
ecode-dev proxy --project . --target https://ecology.example.com
```

可以使用 `ECODE_PROXY_TARGET` 代替 `--target`。只有在可信任、使用自签名证书的开发服务器上才应使用 `--allow-insecure`。

## 仓库内开发

在仓库根目录执行：

```bash
pnpm --filter ecode-dev-runtime build
pnpm --filter ecode-dev-runtime test
```
