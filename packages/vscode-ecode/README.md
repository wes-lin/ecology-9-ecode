# Weaver Ecology eCode for VS Code

English | [简体中文](./README.zh-CN.md)

A VS Code extension for local and remote Weaver Ecology 9 eCode development. It integrates `ecode-sdk` for remote operations and `ecode-dev-runtime` for local compilation, incremental rebuilds, and proxy-based debugging.

## Features

- Manage multiple Ecology environments and switch the active environment from either eCode view.
- Display the active environment directly in the Local and Remote view titles.
- Download remote projects and maintain local eCode metadata.
- Create and edit apps, types, folders, code files, and resources locally or remotely.
- Compare local files with their current remote content.
- Select and publish one or more local apps to the active environment.
- Build local apps, watch source changes, and debug them through a local reverse proxy.
- Reuse valid output from earlier sessions and incrementally compile offline changes.

## Requirements

- VS Code 1.83.0 or later
- A Weaver Ecology 9 server with eCode API access
- A local workspace for downloaded or locally maintained eCode sources

## Environments and Settings

Use the gear action in either view, or run `eCode: Settings`, to open the visual settings editor.

The **Environments** page manages environment records containing:

- Name
- Ecology server URL
- Login account and password
- Local project directory

The **Local Debug** page configures:

- Local proxy host and port
- Automatic browser opening and the initial path
- TLS certificate verification
- Upstream `Host` header rewriting

Environment switching is intentionally kept outside the settings page. Use **Switch Environment** in either the Local or Remote view. The picker shows only the environment name and server address. Changing the active environment refreshes both trees and stops a running local debug session so it cannot continue against stale configuration.

Relative local directories are resolved from the current VS Code workspace. Credentials are stored in VS Code configuration; do not commit workspace settings containing real passwords.

## Local View

The Local view is backed by files under the active environment's local project directory. It supports:

- Creating apps, types, folders, and JavaScript, CSS, or Markdown files
- Adding resource files
- Renaming and deleting nodes
- Setting app release status and preload order
- Setting or clearing file preload state
- Opening local files and comparing them with remote content
- Selecting apps or folders and publishing the represented apps

Local structural changes update `.ecode/ecode-tree.json`; generated `.ecode/apps/<appId>.json` files stay synchronized with that tree.

**Upload Apps** enters checkbox selection mode in the Local tree. Folder checkboxes select descendant apps and app checkboxes can be changed individually. **Publish Apps** builds one package per selected app, uploads it, and imports it into the active environment with the app's release and preload metadata.

## Remote View

The Remote view loads its tree from the active Ecology environment. It supports remote structural operations and direct code editing.

Opening a remote JavaScript, CSS, or Markdown file creates an editable virtual document without downloading it into the project. Saving writes the content to the active environment. Remote resources, JAR files, and the remote side of comparison editors remain read-only.

## Download and Local Metadata

Running **Download** from the Local view downloads source files to `<localDir>/src`, overwrites existing remote-backed source files, and replaces `<localDir>/.ecode/ecode-tree.json` with the latest complete remote tree.

The extension watches `ecode-tree.json` and regenerates `.ecode/apps` whenever the tree is created, changed, or deleted. Stale generated app files are removed automatically.

Locally created apps and types use 32-character UUIDs without separators. Other locally created folders and files use `local-<UUID>` identifiers so they can be distinguished from downloaded nodes.

## Local Debugging

Run `eCode: Start Local Debugging`, or use the start action in the Local view, to:

1. Read the local tree and app metadata.
2. Reuse valid previous output or incrementally compile source changes made between sessions.
3. Watch `src` and `.ecode` for further changes.
4. Start a loopback reverse proxy targeting the active environment.
5. Open the proxied Ecology page when automatic opening is enabled.

JavaScript, CSS, resources, and pre-state files are routed to independent build tasks. Changes gathered in one debounce window are grouped by output target, and unrelated targets run in parallel. A changed pre-state file recompiles only its fragment before `init.js` or `init.css` is assembled once.

Reusable build state is stored at `dist/.ecode-dev-runtime/build-state.json`. Unchanged startup skips compilation; missing output, changed metadata, or incompatible cache data triggers a clean build. The manual `eCode: Build Local Apps` command always performs a clean build.

Local proxy routes include:

- `/cloudstore/dev/init.js`
- `/cloudstore/dev/init.css`
- `/cloudstore/release/**`

Other HTTP and WebSocket requests are forwarded to the active Ecology server.

## Project Layout

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

The local runtime owns `dist/dev`, `dist/release`, and its build-state file. Other directories, such as `dist/app-upgrade`, are preserved.

## Main Commands

| Command                          | Purpose                                            |
| -------------------------------- | -------------------------------------------------- |
| `eCode: Settings`                | Manage environments and local debug settings.      |
| `eCode: Switch Environment`      | Change the active environment.                     |
| `eCode: Start Local Debugging`   | Prepare output, start watching, and run the proxy. |
| `eCode: Stop Local Debugging`    | Stop the current local debug session.              |
| `eCode: Restart Local Debugging` | Restart the debug session with current settings.   |
| `eCode: Build Local Apps`        | Perform a clean local build.                       |
| `eCode: Open Local Ecology`      | Open the running local proxy in a browser.         |

Additional create, rename, delete, upload, release, preload, download, and compare actions are available from the view title bars and tree context menus.

## Development

From the repository root:

```bash
pnpm install
pnpm --filter vscode-ecode build
```

Open the repository in VS Code, select `Run Extension (vscode-ecode)`, and press `F5`.

Create a production bundle or VSIX package with:

```bash
pnpm --filter vscode-ecode build:production
pnpm --filter vscode-ecode package
```

VSIX files are written to `packages/vscode-ecode/releases`.
