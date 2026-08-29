import * as vscode from 'vscode';

export function createEnvironmentSettingsHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const assetRoot = vscode.Uri.joinPath(extensionUri, 'assets', 'settings');
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'settings.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'settings.js'));

  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>eCode Settings</title>
</head>
<body>
  <main class="page">
    <form id="settings-form" novalidate>
      <header class="page-header">
        <div>
          <h1>eCode Settings</h1>
          <p>Configure local debugging and connections used by the Local and Remote views.</p>
        </div>
        <div class="page-actions">
          <div id="status" class="status" role="status" aria-live="polite"></div>
          <div class="action-buttons">
            <button id="discard" class="secondary" type="button">Discard changes</button>
            <button id="save" type="submit">Save settings</button>
          </div>
        </div>
      </header>
      <div class="settings-layout">
        <aside class="settings-sidebar" aria-label="Settings navigation">
          <button id="dev-server-nav" class="nav-item nav-primary" type="button">
            <span class="nav-icon">D</span>
            <span>
              <strong>Local Debug</strong>
              <small>Proxy and browser</small>
            </span>
          </button>
          <div class="nav-section-header">
            <span>Environments</span>
            <button id="add-environment" class="icon-button" type="button" title="Add environment" aria-label="Add environment">+</button>
          </div>
          <div id="environment-nav" class="environment-nav"></div>
        </aside>
        <section id="settings-detail" class="settings-detail" aria-live="polite"></section>
      </div>
    </form>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index++) nonce += characters.charAt(Math.floor(Math.random() * characters.length));
  return nonce;
}
