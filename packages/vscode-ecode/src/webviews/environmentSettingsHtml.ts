import * as vscode from 'vscode';

export function createEnvironmentSettingsHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const assetRoot = vscode.Uri.joinPath(extensionUri, 'assets', 'settings');
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'settings.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webviews', 'settings.js'));

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
        <nav class="settings-tabs" aria-label="Settings sections" role="tablist">
          <button id="dev-server-nav" class="settings-tab" type="button" role="tab">Local Debug</button>
          <button id="environments-nav" class="settings-tab" type="button" role="tab">Environments</button>
        </nav>
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
