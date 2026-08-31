# ecode-sdk

[English](./README.md) | 简体中文

面向泛微 Weaver Ecology 9 eCode API 的 JavaScript SDK，提供登录、目录访问、项目下载、资源上传、应用打包和发布能力。

## 安装

```bash
npm install ecode-sdk
```

需要 Node.js 18 或更高版本。SDK 使用 Node.js 内置的 `fetch`、`FormData` 和 `Blob`，并自动维护登录 Cookie。

## 创建客户端

```js
const { EcodeClient } = require('ecode-sdk');

const client = new EcodeClient({
  baseUrl: 'https://ecology.example.com',
  username: 'sysadmin',
  password: 'your-password',
});

await client.login();
const tree = await client.listTree();
```

客户端会保存登录产生的会话 Cookie，并在后续请求中自动携带。

## 下载项目

`client.download(outputRoot)` 会读取完整远程目录，将源文件写入 `<outputRoot>/src`，并生成 `<outputRoot>/.ecode/ecode-tree.json`。

默认保留已经存在的本地源文件；传入 `overwrite: true` 可以覆盖：

```js
const result = await client.download('/path/to/project', {
  overwrite: true,
  onProgress: (state) => console.log(state),
});

console.log(result.downloaded, result.skipped, result.failed);
```

集成方还可以使用 `prepareTree` 合并远程目录和本地元数据，并决定需要实际下载的文件路径。

## 应用元数据

SDK 可以从 eCode 节点树提取应用配置，并同步 `.ecode/apps` 下的 JSON 文件：

```js
const path = require('node:path');
const { collectEcodeAppConfigs, synchronizeEcodeAppConfigs } = require('ecode-sdk');

const apps = collectEcodeAppConfigs(tree);
await synchronizeEcodeAppConfigs(path.resolve('/path/to/project/.ecode/ecode-tree.json'));
```

同步过程会生成 `.ecode/apps/<appId>.json`，并删除节点树中已经不存在的旧应用元数据。

## 构建应用升级包

`buildAppUpgradePackage` 按指定应用 ID 构建与 Ecology 应用导出结构兼容的 ZIP、发布计划和校验信息：

```js
const { buildAppUpgradePackage } = require('ecode-sdk');

const result = await buildAppUpgradePackage({
  projectRoot: '/path/to/project',
  outputDirectory: '/path/to/project/dist/app-upgrade',
  apps: ['11111111111111111111111111111111'],
});

console.log(result.archivePath);
console.log(result.plan.apps);
```

项目需要包含 `src`、`.ecode/apps` 和 `.ecode/ecode-tree.json`。调用方拥有 `outputDirectory`，SDK 不会清理其中已有的其他文件。如果调用方已经持有应用元数据，可以通过 `appConfigs` 传入，避免再次读取 `.ecode/apps`。

## 发布和导入应用

使用统一上传与导入流程：

```js
const { publishAppUpgradePackage } = require('ecode-sdk');

const published = await publishAppUpgradePackage(client, result.archivePath, result.plan.apps);
console.log(published.fileId, published.appIds);
```

也可以在文件已经上传后，通过 `client.importApps(fileId, options)` 为每个应用设置覆盖、自动发布和配置覆盖选项。

## JavaScript 与 JSX 编译

SDK 内置与旧版 eCode 兼容的 Babel standalone 7.5.5 编译配置，支持 ES2015、经典 JSX、旧版装饰器、类属性和 `transform-instanceof`：

```js
const path = require('node:path');
const { compileJavaScript, compileJavaScriptFile } = require('ecode-sdk');

const code = compileJavaScript('const view = <div>Hello</div>;');
const fileCode = compileJavaScriptFile(path.resolve('index.js'), path.resolve('dist/compiled_index.js'));
```

项目自身的 Babel 配置不会影响该编译器，因此输出保持稳定。

## 仓库内开发

在仓库根目录执行：

```bash
pnpm --filter ecode-sdk build
pnpm --filter ecode-sdk test
```
