# vscode-ecode

VS Code extension for local and remote Ecology 9 eCode development.

## Views

The eCode Activity Bar container contains two views:

- **Local** is the upper view and is backed by local files.
- **Remote** is the lower view and is backed by the remote eCode API.

Running **Download** from the Local view downloads source files to
`<localDir>/src` and replaces `<localDir>/.ecode/ecode-tree.json` with the
latest complete remote tree. Existing local source files are overwritten with
their latest remote contents.

## Configuration Files

Metadata is stored under `<localDir>/.ecode`:

- `ecode-tree.json` is the only local node tree. Download replaces it, and all
  local tree operations read and write it directly.
- `apps/<id>.json` is generated from `ecode-tree.json`. Each file contains
  the app path, status, preload metadata, resources, configs, and debug mode.

The extension watches `ecode-tree.json` and regenerates the app files whenever
the tree is created, changed, or deleted. App JSON files no longer represented
by the tree are removed. The generation API is provided by `ecode-sdk` so Node
scripts can reuse the same behavior.

Local node IDs use `local-<UUID>` with UUID separators removed, for example
`local-8013eb95bbab480f8cd68cf180c63a0e`. The same value is used for a locally
created app's node ID, `appId`, and app JSON filename.

## Local Operations

The Local view supports the same structural and app operations as the Remote
view:

- Create apps, types, folders, and JS/CSS/Markdown files.
- Add files to local resource nodes.
- Rename and delete nodes.
- Set app release status and preload order.
- Set or clear file preload state.
- Compare an existing local file with its current remote content.

Local operations never call the remote API. Structural changes are persisted to
`ecode-tree.json`; file operations affect only `<localDir>/src`.

The built-in VS Code Explorer has no eCode context menu.

Opening a file in the Remote view displays read-only remote content and never
downloads or creates a local file.
