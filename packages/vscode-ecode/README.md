# vscode-ecode

VS Code extension for browsing and downloading Ecology 9 ecode files.

## Features

- Activity Bar icon for eCode.
- Tree view showing ecode directories and files.
- Download files into the configured local directory (default: `src`).
- Configuration: `ecode.baseUrl`, `ecode.username`, `ecode.password`, `ecode.localDir`.

## Configuration

Open VS Code settings and search for `ecode`:

| Setting | Default | Description |
|---------|---------|-------------|
| `ecode.baseUrl` | `http://localhost` | eCode server URL |
| `ecode.username` | `''` | Login account |
| `ecode.password` | `''` | Login password |
| `ecode.localDir` | `src` | Local download directory |

## Commands

- `eCode: Refresh Explorer` — reload the tree.
- `eCode: Download File` — download a selected file to the local directory.

Activation is inferred automatically from `contributes.views` and `contributes.commands`, so no `activationEvents` are needed.
