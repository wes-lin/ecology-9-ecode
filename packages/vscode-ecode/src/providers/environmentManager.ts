import * as path from 'node:path';
import * as vscode from 'vscode';
import { EcodeEnvironmentConfig, getEcodeEnvironments } from '../config/ecodeEnvironment';
import { getErrorMessage } from '../utils/errors';

type EnvironmentManagerMessage = {
  command?: unknown;
  environments?: unknown;
  activeIndex?: unknown;
  index?: unknown;
  name?: unknown;
};

export class EcodeEnvironmentManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'ecode.environmentManager',
      'eCode Environments',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      }
    );
    this.panel = panel;
    panel.webview.html = this.getHtml();

    panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );
    panel.webview.onDidReceiveMessage(
      (message: EnvironmentManagerMessage) => this.handleMessage(message),
      undefined,
      this.disposables
    );
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  private async handleMessage(message: EnvironmentManagerMessage): Promise<void> {
    switch (message.command) {
      case 'ready':
        await this.postState();
        break;
      case 'save':
        await this.save(message.environments, message.activeIndex);
        break;
      case 'browseLocalDir':
        await this.browseLocalDirectory(message.index);
        break;
      case 'confirmDelete':
        await this.confirmDelete(message.index, message.name);
        break;
      case 'confirmDiscard':
        await this.confirmDiscard();
        break;
    }
  }

  private async postState(): Promise<void> {
    if (!this.panel) return;
    const config = vscode.workspace.getConfiguration('ecode');
    const environments = getEcodeEnvironments(config);
    const configuredActiveName = config.get<string>('activeEnvironment', '');
    const activeIndex = Math.max(
      0,
      environments.findIndex((environment) => environment.name === configuredActiveName)
    );
    await this.panel.webview.postMessage({ type: 'state', environments, activeIndex });
  }

  private async save(rawEnvironments: unknown, rawActiveIndex: unknown): Promise<void> {
    try {
      const environments = this.validateEnvironments(rawEnvironments);
      const activeIndex = typeof rawActiveIndex === 'number' ? rawActiveIndex : 0;
      const activeEnvironment = environments[activeIndex] ?? environments[0];
      const config = vscode.workspace.getConfiguration('ecode');

      await config.update('environments', environments, this.getConfigurationTarget(config, 'environments'));
      await config.update(
        'activeEnvironment',
        activeEnvironment?.name ?? '',
        this.getConfigurationTarget(config, 'activeEnvironment')
      );
      await this.panel?.webview.postMessage({
        type: 'saved',
        environments,
        activeIndex: activeEnvironment ? environments.indexOf(activeEnvironment) : 0,
      });
      vscode.window.showInformationMessage('eCode environments saved.');
    } catch (error) {
      const message = getErrorMessage(error);
      await this.panel?.webview.postMessage({ type: 'error', message });
      vscode.window.showErrorMessage(`Could not save eCode environments: ${message}`);
    }
  }

  private validateEnvironments(value: unknown): EcodeEnvironmentConfig[] {
    if (!Array.isArray(value)) throw new Error('Environment data must be a list.');

    const environments = value.map((item, index) => {
      if (!item || typeof item !== 'object') throw new Error(`Environment ${index + 1} is invalid.`);
      const record = item as Record<string, unknown>;
      const environment: EcodeEnvironmentConfig = {
        name: this.stringValue(record.name),
        baseUrl: this.stringValue(record.baseUrl).replace(/\/+$/, ''),
        username: this.stringValue(record.username),
        password: this.stringValue(record.password),
        localDir: this.stringValue(record.localDir) || './',
      };

      if (!environment.name) throw new Error(`Environment ${index + 1} needs a name.`);
      if (!environment.baseUrl) throw new Error(`Environment "${environment.name}" needs a server URL.`);
      let url: URL;
      try {
        url = new URL(environment.baseUrl);
      } catch {
        throw new Error(`Environment "${environment.name}" has an invalid server URL.`);
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Environment "${environment.name}" must use an HTTP or HTTPS server URL.`);
      }
      if (!environment.username) throw new Error(`Environment "${environment.name}" needs an account.`);
      if (!environment.password) throw new Error(`Environment "${environment.name}" needs a password.`);
      return environment;
    });

    const names = new Set<string>();
    for (const environment of environments) {
      const key = environment.name.toLowerCase();
      if (names.has(key)) throw new Error(`Environment name "${environment.name}" is duplicated.`);
      names.add(key);
    }
    return environments;
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private getConfigurationTarget(
    config: vscode.WorkspaceConfiguration,
    key: 'environments' | 'activeEnvironment'
  ): vscode.ConfigurationTarget {
    const inspection = config.inspect(key);
    if (inspection?.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder;
    if (inspection?.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace;
    if (inspection?.globalValue !== undefined) return vscode.ConfigurationTarget.Global;
    return vscode.ConfigurationTarget.Global;
  }

  private async browseLocalDirectory(rawIndex: unknown): Promise<void> {
    const index = typeof rawIndex === 'number' ? rawIndex : -1;
    if (index < 0) return;

    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use as local directory',
      title: 'Select the eCode local directory',
    });
    if (!selected?.[0] || !this.panel) return;

    const selectedPath = selected[0].fsPath;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    let localDir = selectedPath;
    if (workspaceFolder) {
      const relativePath = path.relative(workspaceFolder.uri.fsPath, selectedPath);
      if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) localDir = relativePath || '.';
    }
    await this.panel.webview.postMessage({ type: 'localDir', index, localDir });
  }

  private async confirmDelete(rawIndex: unknown, rawName: unknown): Promise<void> {
    const index = typeof rawIndex === 'number' ? rawIndex : -1;
    if (index < 0 || !this.panel) return;

    const name = this.stringValue(rawName) || 'this environment';
    const confirmation = await vscode.window.showWarningMessage(
      `Delete "${name}"?`,
      { modal: true },
      'Delete'
    );
    if (confirmation === 'Delete') await this.panel.webview.postMessage({ type: 'deleteConfirmed', index });
  }

  private async confirmDiscard(): Promise<void> {
    if (!this.panel) return;

    const confirmation = await vscode.window.showWarningMessage(
      'Discard all unsaved changes?',
      { modal: true },
      'Discard'
    );
    if (confirmation === 'Discard') await this.panel.webview.postMessage({ type: 'discardConfirmed' });
  }

  private getHtml(): string {
    const nonce = createNonce();
    return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>eCode Environments</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font: var(--vscode-font-size)/1.5 var(--vscode-font-family);
    }
    .page { width: min(920px, calc(100% - 40px)); margin: 0 auto; padding: 36px 0 80px; }
    .page-header { display: flex; gap: 24px; align-items: flex-start; justify-content: space-between; margin-bottom: 26px; }
    h1 { margin: 0 0 6px; font-size: 26px; line-height: 1.25; font-weight: 600; }
    .subtitle { margin: 0; color: var(--vscode-descriptionForeground); }
    button {
      min-height: 32px;
      border: 1px solid transparent;
      border-radius: 2px;
      padding: 5px 12px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:focus-visible, input:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.icon-button {
      min-width: 30px;
      padding: 3px 8px;
      color: var(--vscode-foreground);
      background: transparent;
      border-color: transparent;
    }
    button.icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }
    button.icon-button.danger:hover { color: var(--vscode-errorForeground); }
    button:disabled { opacity: .45; cursor: default; }
    .environment-list { display: grid; gap: 14px; }
    .card {
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 6px;
      background: var(--vscode-sideBar-background);
      overflow: hidden;
    }
    .card-header {
      min-height: 48px;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px 8px 16px;
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    .active-control { display: flex; align-items: center; gap: 9px; min-width: 0; font-weight: 600; cursor: pointer; }
    .active-control input { accent-color: var(--vscode-focusBorder); }
    .card-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .active-badge {
      padding: 1px 7px;
      border-radius: 10px;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
      font-size: 11px;
      font-weight: 400;
    }
    .card-actions { display: flex; margin-left: auto; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 18px; padding: 18px; }
    .field { min-width: 0; }
    .field.wide { grid-column: 1 / -1; }
    label.field-label { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 600; }
    .hint { margin-top: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    input[type="text"], input[type="url"], input[type="password"] {
      width: 100%;
      height: 30px;
      padding: 4px 8px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font: inherit;
    }
    input::placeholder { color: var(--vscode-input-placeholderForeground); }
    .input-action { display: flex; }
    .input-action input { min-width: 0; border-radius: 2px 0 0 2px; }
    .input-action button { flex: 0 0 auto; min-height: 30px; border-radius: 0 2px 2px 0; }
    .empty {
      padding: 58px 24px;
      border: 1px dashed var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 6px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
    .empty strong { display: block; margin-bottom: 4px; color: var(--vscode-foreground); font-size: 15px; }
    .footer {
      position: sticky;
      bottom: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 22px;
      padding: 14px 0;
      background: var(--vscode-editor-background);
      border-top: 1px solid var(--vscode-panel-border);
    }
    .status { min-height: 20px; margin-right: auto; color: var(--vscode-descriptionForeground); }
    .status.error { color: var(--vscode-errorForeground); }
    @media (max-width: 640px) {
      .page { width: min(100% - 24px, 920px); padding-top: 22px; }
      .page-header { display: block; }
      .page-header button { margin-top: 14px; }
      .fields { grid-template-columns: 1fr; }
      .field.wide { grid-column: auto; }
      .card-actions button:not(.danger) { display: none; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="page-header">
      <div>
        <h1>Environments</h1>
        <p class="subtitle">Manage eCode servers and choose the environment used by Local and Remote views.</p>
      </div>
      <button id="add" type="button">+ Add environment</button>
    </header>
    <form id="form">
      <div id="environment-list" class="environment-list"></div>
      <div class="footer">
        <div id="status" class="status" role="status" aria-live="polite"></div>
        <button id="reload" class="secondary" type="button">Discard changes</button>
        <button id="save" type="submit">Save environments</button>
      </div>
    </form>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('environment-list');
    const form = document.getElementById('form');
    const status = document.getElementById('status');
    let environments = [];
    let activeIndex = 0;
    let dirty = false;

    function setStatus(message, isError = false) {
      status.textContent = message;
      status.classList.toggle('error', isError);
    }

    function markDirty() {
      dirty = true;
      setStatus('Unsaved changes');
    }

    function uniqueName() {
      const used = new Set(environments.map((environment) => environment.name.toLowerCase()));
      let number = environments.length + 1;
      let name = 'Environment ' + number;
      while (used.has(name.toLowerCase())) name = 'Environment ' + ++number;
      return name;
    }

    function createField(card, labelText, property, options = {}) {
      const wrapper = document.createElement('div');
      wrapper.className = 'field' + (options.wide ? ' wide' : '');
      const label = document.createElement('label');
      label.className = 'field-label';
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = options.type || 'text';
      input.placeholder = options.placeholder || '';
      input.value = card.environment[property] || '';
      input.required = options.required !== false;
      input.autocomplete = options.autocomplete || 'off';
      input.addEventListener('input', () => {
        card.environment[property] = input.value;
        if (property === 'name') card.title.textContent = input.value || 'Unnamed environment';
        markDirty();
      });
      wrapper.append(label);
      if (options.action) {
        const row = document.createElement('div');
        row.className = 'input-action';
        row.append(input, options.action(input));
        wrapper.append(row);
      } else {
        wrapper.append(input);
      }
      if (options.hint) {
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = options.hint;
        wrapper.append(hint);
      }
      card.fields.append(wrapper);
    }

    function actionButton(label, title, handler, className = '') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'icon-button ' + className;
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.addEventListener('click', handler);
      return button;
    }

    function render() {
      list.replaceChildren();
      if (environments.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        const title = document.createElement('strong');
        title.textContent = 'No environments configured';
        const text = document.createElement('span');
        text.textContent = 'Add an environment to connect eCode Explorer to a server.';
        empty.append(title, text);
        list.append(empty);
        return;
      }

      environments.forEach((environment, index) => {
        const element = document.createElement('section');
        element.className = 'card';
        const header = document.createElement('div');
        header.className = 'card-header';
        const activeControl = document.createElement('label');
        activeControl.className = 'active-control';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'active-environment';
        radio.checked = index === activeIndex;
        radio.title = 'Use this environment';
        radio.addEventListener('change', () => {
          activeIndex = index;
          markDirty();
          render();
        });
        const cardTitle = document.createElement('span');
        cardTitle.className = 'card-title';
        cardTitle.textContent = environment.name || 'Unnamed environment';
        activeControl.append(radio, cardTitle);
        if (index === activeIndex) {
          const badge = document.createElement('span');
          badge.className = 'active-badge';
          badge.textContent = 'Active';
          activeControl.append(badge);
        }
        const actions = document.createElement('div');
        actions.className = 'card-actions';
        const up = actionButton('↑', 'Move up', () => moveEnvironment(index, -1));
        const down = actionButton('↓', 'Move down', () => moveEnvironment(index, 1));
        up.disabled = index === 0;
        down.disabled = index === environments.length - 1;
        actions.append(
          up,
          down,
          actionButton(
            '×',
            'Delete environment',
            () => vscode.postMessage({ command: 'confirmDelete', index, name: environment.name }),
            'danger'
          )
        );
        header.append(activeControl, actions);
        const fields = document.createElement('div');
        fields.className = 'fields';
        element.append(header, fields);
        list.append(element);
        const card = { environment, title: cardTitle, fields };
        createField(card, 'Name', 'name', { placeholder: 'Development' });
        createField(card, 'Server URL', 'baseUrl', { type: 'url', placeholder: 'https://ecode.example.com' });
        createField(card, 'Account', 'username', { placeholder: 'Login account', autocomplete: 'username' });
        createField(card, 'Password', 'password', {
          type: 'password',
          autocomplete: 'current-password',
          action: (input) => {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'secondary';
            toggle.textContent = 'Show';
            toggle.addEventListener('click', () => {
              const showing = input.type === 'text';
              input.type = showing ? 'password' : 'text';
              toggle.textContent = showing ? 'Show' : 'Hide';
            });
            return toggle;
          },
        });
        createField(card, 'Local directory', 'localDir', {
          wide: true,
          placeholder: './',
          hint: 'Relative paths are resolved from the current workspace.',
          action: () => {
            const browse = document.createElement('button');
            browse.type = 'button';
            browse.className = 'secondary';
            browse.textContent = 'Browse…';
            browse.addEventListener('click', () => vscode.postMessage({ command: 'browseLocalDir', index }));
            return browse;
          },
        });
      });
    }

    function moveEnvironment(index, offset) {
      const target = index + offset;
      if (target < 0 || target >= environments.length) return;
      [environments[index], environments[target]] = [environments[target], environments[index]];
      if (activeIndex === index) activeIndex = target;
      else if (activeIndex === target) activeIndex = index;
      markDirty();
      render();
    }

    function removeEnvironment(index) {
      if (index < 0 || index >= environments.length) return;
      environments.splice(index, 1);
      if (activeIndex === index) activeIndex = Math.min(index, environments.length - 1);
      else if (activeIndex > index) activeIndex--;
      activeIndex = Math.max(0, activeIndex);
      markDirty();
      render();
    }

    document.getElementById('add').addEventListener('click', () => {
      environments.push({ name: uniqueName(), baseUrl: '', username: '', password: '', localDir: './' });
      if (environments.length === 1) activeIndex = 0;
      markDirty();
      render();
      const cards = list.querySelectorAll('.card');
      cards[cards.length - 1]?.querySelector('input[type="text"]')?.focus();
    });

    document.getElementById('reload').addEventListener('click', () => {
      if (!dirty) vscode.postMessage({ command: 'ready' });
      else vscode.postMessage({ command: 'confirmDiscard' });
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const names = environments.map((environment) => environment.name.trim().toLowerCase());
      if (new Set(names).size !== names.length) {
        setStatus('Environment names must be unique.', true);
        return;
      }
      setStatus('Saving…');
      vscode.postMessage({ command: 'save', environments, activeIndex });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'state' || message.type === 'saved') {
        environments = message.environments;
        activeIndex = message.activeIndex;
        dirty = false;
        setStatus(message.type === 'saved' ? 'Saved' : '');
        render();
      } else if (message.type === 'localDir' && environments[message.index]) {
        environments[message.index].localDir = message.localDir;
        markDirty();
        render();
      } else if (message.type === 'deleteConfirmed') {
        removeEnvironment(message.index);
      } else if (message.type === 'discardConfirmed') {
        vscode.postMessage({ command: 'ready' });
      } else if (message.type === 'error') {
        setStatus(message.message, true);
      }
    });

    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index++) nonce += characters.charAt(Math.floor(Math.random() * characters.length));
  return nonce;
}
