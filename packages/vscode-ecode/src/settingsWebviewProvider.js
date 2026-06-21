const vscode = require('vscode');

class EcodeSettingsWebviewProvider {
  constructor(extensionUri, onSave) {
    this.extensionUri = extensionUri;
    this.onSave = onSave;
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'save') {
        const config = vscode.workspace.getConfiguration('ecode');
        await config.update('baseUrl', message.baseUrl, true);
        await config.update('username', message.username, true);
        await config.update('password', message.password, true);
        await config.update('localDir', message.localDir, true);
        vscode.window.showInformationMessage('eCode settings saved');
        this.onSave();
      }
    });
  }

  refresh() {
    if (this._view) {
      this._view.webview.html = this._getHtml(this._view.webview);
    }
  }

  _getHtml(webview) {
    const config = vscode.workspace.getConfiguration('ecode');
    const baseUrl = config.get('baseUrl', 'http://localhost');
    const username = config.get('username', '');
    const password = config.get('password', '');
    const localDir = config.get('localDir', 'src');

    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>eCode Settings</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 12px;
    }
    .field {
      margin-bottom: 12px;
    }
    label {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
      font-weight: 600;
    }
    .icon {
      font-size: 1.1em;
      line-height: 1;
    }
    input {
      width: 100%;
      padding: 6px 8px;
      box-sizing: border-box;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
    }
    button {
      width: 100%;
      padding: 8px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      margin-top: 8px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <div class="field">
    <label for="baseUrl"><span class="icon">🌐</span> Server</label>
    <input id="baseUrl" type="text" value="${baseUrl}">
  </div>
  <div class="field">
    <label for="username"><span class="icon">👤</span> Account</label>
    <input id="username" type="text" value="${username}">
  </div>
  <div class="field">
    <label for="password"><span class="icon">🔒</span> Password</label>
    <input id="password" type="password" value="${password}">
  </div>
  <div class="field">
    <label for="localDir"><span class="icon">📁</span> Local Dir</label>
    <input id="localDir" type="text" value="${localDir}">
  </div>
  <button id="saveBtn">Save Settings</button>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('saveBtn').addEventListener('click', () => {
      vscode.postMessage({
        command: 'save',
        baseUrl: document.getElementById('baseUrl').value,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        localDir: document.getElementById('localDir').value,
      });
    });
  </script>
</body>
</html>`;
  }

  _getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}

module.exports = { EcodeSettingsWebviewProvider };
