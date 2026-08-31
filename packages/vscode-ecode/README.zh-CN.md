# Weaver Ecology eCode VS Code 插件

[English](./README.md) | 简体中文

用于泛微 Weaver Ecology 9 eCode 本地与远程开发的 VS Code 插件。插件通过 `ecode-sdk` 完成远程操作，并使用 `ecode-dev-runtime` 提供本地编译、增量重建和基于代理的调试能力。

## 核心功能

- 管理多个 Ecology 环境，并从任意 eCode 视图切换当前环境。
- 在 Local 和 Remote 视图标题中直接显示当前环境。
- 下载远程项目并维护本地 eCode 元数据。
- 在本地或远程创建和编辑应用、类型、目录、代码文件及资源。
- 比较本地文件与当前环境中的远程内容。
- 选择并发布一个或多个本地应用到当前环境。
- 编译本地应用、监听源文件变化，并通过本地反向代理进行调试。
- 复用历史有效输出，并增量编译调试停止期间产生的变化。

## 环境要求

- VS Code 1.83.0 或更高版本
- 可以访问 eCode API 的 Weaver Ecology 9 服务器
- 用于下载或维护 eCode 源码的本地工作区

## 环境与设置

点击任意视图标题栏中的齿轮按钮，或执行 `eCode: Settings`，可以打开可视化设置页面。

**Environments** 页面管理以下环境信息：

- 环境名称
- Ecology 服务器地址
- 登录账号和密码
- 本地项目目录

**Local Debug** 页面配置：

- 本地代理监听地址和端口
- 浏览器自动打开及初始路径
- TLS 证书校验
- 上游 `Host` 请求头改写

设置页面不负责切换环境。请使用 Local 或 Remote 视图中的 **Switch Environment**；选择列表只显示环境名称和服务器地址。切换环境后，两个目录树都会刷新；如果本地调试正在运行，插件会先停止当前会话，避免继续代理到旧环境。

相对本地目录以当前 VS Code 工作区为基准。账号密码保存在 VS Code 配置中，请勿提交包含真实密码的工作区设置。

## Local 视图

Local 视图基于当前环境对应的本地项目文件，支持：

- 创建应用、类型、目录以及 JavaScript、CSS、Markdown 文件
- 添加资源文件
- 重命名和删除节点
- 设置应用发布状态和前置加载顺序
- 设置或取消文件前置加载状态
- 打开本地文件，并与远程内容比较
- 选择应用或目录并发布其中的应用

本地结构变化会写入 `.ecode/ecode-tree.json`，生成的 `.ecode/apps/<appId>.json` 会与节点树保持同步。

执行 **Upload Apps** 后，Local 树会进入复选框选择模式。选择目录会选中其下所有应用，也可以单独调整应用。执行 **Publish Apps** 后，插件为每个已选应用构建升级包、上传并导入到当前环境，同时保留应用发布状态和前置加载元数据。

## Remote 视图

Remote 视图从当前 Ecology 环境加载目录，支持远程结构操作和代码直接编辑。

打开远程 JavaScript、CSS 或 Markdown 文件时，插件会创建可编辑的虚拟文档，不会先下载到本地项目。保存文档会直接写回当前环境。远程资源、JAR 文件以及比较编辑器中的远程一侧保持只读。

## 下载与本地元数据

在 Local 视图执行 **Download** 后，插件会把源文件下载到 `<localDir>/src`，覆盖已有的远程来源文件，并用最新完整远程目录替换 `<localDir>/.ecode/ecode-tree.json`。

插件监听 `ecode-tree.json`，在文件创建、修改或删除后重新生成 `.ecode/apps`，并自动删除已经不在节点树中的旧应用文件。

本地创建的应用和类型使用不带分隔符的 32 位 UUID。其他本地目录和文件使用 `local-<UUID>`，用于与远程下载节点区分。

## 本地调试

执行 `eCode: Start Local Debugging`，或点击 Local 视图中的启动按钮后，插件会：

1. 读取本地节点树和应用元数据。
2. 复用历史有效输出，或增量编译两次会话之间产生的源文件变化。
3. 监听 `src` 和 `.ecode` 的后续变化。
4. 启动指向当前环境的本地回环反向代理。
5. 在启用自动打开时，通过浏览器访问代理后的 Ecology 页面。

JavaScript、CSS、资源和前置加载文件会路由到独立任务。同一个防抖窗口内的变化按输出目标合并，无关目标并行执行。单个前置加载文件变化时，只重新编译对应片段，然后统一组装一次 `init.js` 或 `init.css`。

可复用构建状态保存在 `dist/.ecode-dev-runtime/build-state.json`。没有变化时启动过程会跳过编译；输出缺失、元数据变化或缓存不兼容时自动执行完整构建。手动执行 `eCode: Build Local Apps` 始终进行完整构建。

本地代理直接提供：

- `/cloudstore/dev/init.js`
- `/cloudstore/dev/init.css`
- `/cloudstore/release/**`

其他 HTTP 和 WebSocket 请求转发到当前 Ecology 服务器。

## 项目目录

```text
<localDir>/
├─ .ecode/
│  ├─ ecode-tree.json
│  └─ apps/<appId>.json
├─ src/
└─ dist/
   ├─ dev/
   ├─ release/
   └─ .ecode-dev-runtime/build-state.json
```

本地 runtime 只维护 `dist/dev`、`dist/release` 和构建状态文件，`dist/app-upgrade` 等其他目录会被保留。

## 主要命令

| 命令                             | 用途                               |
| -------------------------------- | ---------------------------------- |
| `eCode: Settings`                | 管理环境和本地调试设置。           |
| `eCode: Switch Environment`      | 切换当前环境。                     |
| `eCode: Start Local Debugging`   | 准备输出、启动监听并运行代理。     |
| `eCode: Stop Local Debugging`    | 停止当前本地调试会话。             |
| `eCode: Restart Local Debugging` | 使用当前设置重新启动调试会话。     |
| `eCode: Build Local Apps`        | 执行本地完整构建。                 |
| `eCode: Open Local Ecology`      | 在浏览器中打开正在运行的本地代理。 |

其他创建、重命名、删除、上传、发布、前置加载、下载和比较操作，可以从视图标题栏与树节点上下文菜单中使用。

## 仓库内开发

在仓库根目录执行：

```bash
pnpm install
pnpm --filter vscode-ecode build
```

使用 VS Code 打开仓库，选择 `Run Extension (vscode-ecode)` 并按 `F5`。

生成生产构建或 VSIX：

```bash
pnpm --filter vscode-ecode build:production
pnpm --filter vscode-ecode package
```

VSIX 文件输出到 `packages/vscode-ecode/releases`。
