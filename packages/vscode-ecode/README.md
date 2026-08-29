# vscode-ecode

VS Code extension for local and remote Ecology 9 eCode development.

## Views

The eCode Activity Bar container contains two views:

- **Local** is the upper view and is backed by local files.
- **Remote** is the lower view and is backed by the remote eCode API.

Use the gear button in either view, or run **eCode: Manage Settings** from the
Command Palette, to open the visual settings editor. It manages the standalone
local development server configuration as well as adding, removing, reordering,
and selecting environments. Saving the form updates `ecode.devServer`,
`ecode.environments`, and `ecode.activeEnvironment`.

Running **Download** from the Local view downloads source files to
`<localDir>/src` and replaces `<localDir>/.ecode/ecode-tree.json` with the
latest complete remote tree. Existing local source files are overwritten with
their latest remote contents. `localDir` defaults to `./`, the current workspace
directory.

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

Locally created apps and types use 32-character UUIDs without separators or a
`local-` prefix. A locally created app uses the same UUID for its node ID,
`appId`, and app JSON filename. Other locally created folders and files use
`local-<UUID>` IDs so the extension can distinguish them from downloaded nodes.

## Local Operations

The Local view supports the same structural and app operations as the Remote
view:

- Create apps, types, folders, and JS/CSS/Markdown files.
- Add files to local resource nodes.
- Rename and delete nodes.
- Set app release status and preload order.
- Set or clear file preload state.
- Compare an existing local file with its current remote content.
- Select and publish local apps to the active eCode environment.

Local structural and file operations are persisted locally. **Publish Local
Apps** is the remote operation: it builds one package per selected app, uploads
each package, and imports it into the active environment. Publishing enters a
selection mode directly in the existing Local tree. Only apps represented by
Local tree nodes with an `appId` participate: folder checkboxes select or clear
all descendant apps, and app checkboxes can be changed individually. Publishing
passes app metadata collected from `ecode-tree.json` directly to the SDK.

The built-in VS Code Explorer has no eCode context menu.

Opening a code file in the Remote view displays editable remote content without
downloading or creating a local file. Saving the editor writes the updated
content directly to the active eCode environment. Remote resources, JAR files,
and the remote side of a comparison remain read-only.

## Local Debugging

Use **eCode: Start Local Debugging** or the play button in the Local view to:

1. Prepare released local apps in `<localDir>/dist`, reusing valid output from the previous session.
2. Watch `src` and `.ecode` for incremental rebuilds.
3. Start a loopback reverse proxy to the active environment's `baseUrl`.
4. Open the local proxy URL when `autoOpen` is enabled in `ecode.devServer`.

After the initial clean build, source changes use Gulp-style task routing: JS,
CSS, resources, and pre-state output are rebuilt independently. Application
metadata, tree ordering, and compiled pre-state fragments stay cached until a
`.ecode` metadata file changes. A pre-state edit recompiles only that fragment
before reassembling `init.js` or `init.css`. Changes collected in the same
watch window are grouped by output target and independent targets run in
parallel.

Local Debugging persists file and output signatures plus compiled pre-state
fragments in `dist/.ecode-dev-runtime/build-state.json`. When the next session
starts with no changes, it skips compilation. Source changes made while
debugging was stopped are rebuilt incrementally; changed metadata, missing
output, or an incompatible cache automatically triggers a clean build. The
manual build command always performs a clean build.

The extension bundles `ecode-dev-runtime`, `ecode-sdk.js`, and `wea.js`; an
eCode project does not need Gulp, BrowserSync, Babel, or its own copy of the
runtime assets. Use the stop button, the status bar item, or the corresponding
commands to manage the session. Changing the active environment or any
`ecode.devServer` setting stops the current session so it cannot continue
proxying to stale configuration.

The standalone `ecode.devServer` object contains `host`, `port`, `autoOpen`,
`openPath`, `strictSSL`, and `changeOrigin`. It is editable in **Manage
Settings** and is independent from the active OA environment.
