import type { EcodeEnvironmentConfig } from '../../config/ecodeEnvironment';
import type {
  EditableEcodeDevServerConfig,
  EnvironmentSettingsRequest,
  EnvironmentSettingsResponse,
} from '../environmentSettingsMessages';

declare function acquireVsCodeApi(): { postMessage(message: EnvironmentSettingsRequest): void };

type EditableModel = EcodeEnvironmentConfig | EditableEcodeDevServerConfig;
type EditableProperty = keyof EcodeEnvironmentConfig | keyof EditableEcodeDevServerConfig;
type SettingsView = 'devServer' | 'environments';

type FieldOptions = {
  wide?: boolean;
  type?: string;
  placeholder?: string;
  autocomplete?: AutoFill;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  validate?: (value: string) => string;
  onInput?: (value: string) => void;
  action?: (input: HTMLInputElement) => HTMLElement;
};

type ValidationIssue = {
  environmentIndex: number | null;
  property: EditableProperty;
  message: string;
};

function requiredElement<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing settings element: ${id}`);
  return value as T;
}

const vscode = acquireVsCodeApi();
const form = requiredElement<HTMLFormElement>('settings-form');
const detail = requiredElement<HTMLElement>('settings-detail');
const devServerNav = requiredElement<HTMLButtonElement>('dev-server-nav');
const environmentsNav = requiredElement<HTMLButtonElement>('environments-nav');
const discardButton = requiredElement<HTMLButtonElement>('discard');
const saveButton = requiredElement<HTMLButtonElement>('save');
const status = requiredElement<HTMLElement>('status');

let environments: EcodeEnvironmentConfig[] = [];
let devServer: EditableEcodeDevServerConfig = {
  host: '127.0.0.1',
  port: 9090,
  autoOpen: true,
  openPath: '/',
  strictSSL: true,
  changeOrigin: true,
};
let activeIndex = 0;
let selectedEnvironmentIndex: number | null = null;
let activeView: SettingsView = 'devServer';
let dirty = false;

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className = '',
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function setStatus(message: string, isError = false): void {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function updateActionState(): void {
  discardButton.disabled = !dirty;
  saveButton.disabled = !dirty;
}

function markDirty(): void {
  dirty = true;
  setStatus('Unsaved changes');
  updateActionState();
}

function uniqueEnvironmentName(): string {
  const usedNames = new Set(environments.map((environment) => String(environment.name).trim().toLowerCase()));
  let number = environments.length + 1;
  let name = `Environment ${number}`;
  while (usedNames.has(name.toLowerCase())) name = `Environment ${++number}`;
  return name;
}

function environmentSummary(environment: EcodeEnvironmentConfig): string {
  const baseUrl = String(environment.baseUrl || '').trim();
  if (!baseUrl) return 'Server not configured';
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

function selectDevServer(): void {
  activeView = 'devServer';
  renderNavigation();
  renderDetail();
}

function selectEnvironment(index: number): void {
  if (!environments[index]) return;
  activeView = 'environments';
  selectedEnvironmentIndex = index;
  renderNavigation();
  renderDetail();
}

function selectEnvironments(): void {
  activeView = 'environments';
  selectedEnvironmentIndex = null;
  renderNavigation();
  renderDetail();
}

function renderNavigation(): void {
  const isDevServer = activeView === 'devServer';
  devServerNav.classList.toggle('selected', isDevServer);
  devServerNav.setAttribute('aria-selected', String(isDevServer));
  environmentsNav.classList.toggle('selected', !isDevServer);
  environmentsNav.setAttribute('aria-selected', String(!isDevServer));
}

function updateEnvironmentSummary(environment: EcodeEnvironmentConfig, index: number): void {
  const editorTitle = detail.querySelector('[data-role="environment-editor-title"]');
  const rowName = detail.querySelector(`[data-role="environment-name-${index}"]`);
  const rowServer = detail.querySelector(`[data-role="environment-server-${index}"]`);
  if (editorTitle) {
    editorTitle.textContent = `Edit ${String(environment.name || '').trim() || 'Unnamed environment'}`;
  }
  if (rowName) rowName.textContent = String(environment.name || '').trim() || 'Unnamed environment';
  if (rowServer) rowServer.textContent = environmentSummary(environment);
}

function createSection(title: string, description: string, container: HTMLElement = detail): HTMLElement {
  const section = element('section', 'form-section');
  section.append(element('h3', '', title));
  if (description) section.append(element('p', 'section-description', description));
  const fields = element('div', 'fields');
  section.append(fields);
  container.append(section);
  return fields;
}

function setFieldError(input: HTMLInputElement, error: HTMLElement, message: string): void {
  input.classList.toggle('invalid', Boolean(message));
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  error.textContent = message || '';
}

function createField(
  fields: HTMLElement,
  model: EditableModel,
  property: EditableProperty,
  labelText: string,
  options: FieldOptions = {}
): HTMLInputElement {
  const wrapper = element('div', `field${options.wide ? ' wide' : ''}`);
  const label = element('label', 'field-label', labelText);
  const input = document.createElement('input');
  const error = element('div', 'field-error');
  const inputId = `setting-${property}-${selectedEnvironmentIndex === null ? 'dev' : selectedEnvironmentIndex}`;

  input.id = inputId;
  input.dataset.property = property;
  input.type = options.type || 'text';
  input.value = String(model[property as keyof typeof model] ?? '');
  input.placeholder = options.placeholder || '';
  input.autocomplete = options.autocomplete || 'off';
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.step !== undefined) input.step = String(options.step);
  label.htmlFor = inputId;

  const validateInput = () => {
    const message = options.validate ? options.validate(input.value) : '';
    setFieldError(input, error, message);
    return !message;
  };

  input.addEventListener('input', () => {
    (model as unknown as Record<EditableProperty, unknown>)[property] = input.value;
    if (input.classList.contains('invalid')) validateInput();
    markDirty();
    options.onInput?.(input.value);
  });
  input.addEventListener('blur', validateInput);

  wrapper.append(label);
  if (options.action) {
    const inputAction = element('div', 'input-action');
    inputAction.append(input, options.action(input));
    wrapper.append(inputAction);
  } else {
    wrapper.append(input);
  }
  if (options.hint) wrapper.append(element('div', 'hint', options.hint));
  wrapper.append(error);
  fields.append(wrapper);
  return input;
}

function createToggle(
  container: HTMLElement,
  model: EditableModel,
  property: EditableProperty,
  title: string,
  description: string,
  onChange?: () => void
): void {
  const row = element('label', 'toggle-row');
  const copy = element('span', 'toggle-copy');
  copy.append(element('strong', '', title), element('small', '', description));

  const toggle = element('span', 'switch');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(model[property as keyof typeof model]);
  input.addEventListener('change', () => {
    (model as unknown as Record<EditableProperty, unknown>)[property] = input.checked;
    markDirty();
    onChange?.();
  });
  toggle.append(input, element('span', 'switch-track'));
  row.append(copy, toggle);
  container.append(row);
}

function required(value: unknown, label: string): string {
  return String(value).trim() ? '' : `${label} is required.`;
}

function validatePort(value: unknown): string {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? '' : 'Port must be an integer between 1 and 65535.';
}

function validateServerUrl(value: unknown): string {
  if (!String(value).trim()) return 'Server URL is required.';
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? '' : 'Use an HTTP or HTTPS URL.';
  } catch {
    return 'Enter a valid server URL.';
  }
}

function renderDevServerDetail(): void {
  detail.append(element('p', 'detail-description', 'Configure the local proxy and browser startup behavior.'));

  const networkFields = createSection('Network', 'The address used by the local eCode development server.');
  createField(networkFields, devServer, 'host', 'Host', {
    placeholder: '127.0.0.1',
    validate: (value) => required(value, 'Host'),
  });
  createField(networkFields, devServer, 'port', 'Port', {
    type: 'number',
    min: 1,
    max: 65535,
    step: 1,
    placeholder: '9090',
    validate: validatePort,
  });

  const browserSection = createSection('Browser', 'Control what opens after local debugging starts.');
  const browserToggles = element('div', 'field wide');
  browserSection.append(browserToggles);
  createToggle(
    browserToggles,
    devServer,
    'autoOpen',
    'Open automatically after startup',
    'Open the proxied Ecology site when the server is ready.',
    renderDetail
  );
  if (devServer.autoOpen) {
    createField(browserSection, devServer, 'openPath', 'Open path', {
      wide: true,
      placeholder: '/',
      hint: 'Path opened through the local proxy after startup.',
      validate: (value) => required(value, 'Open path'),
    });
  }

  const proxySection = createSection(
    'Upstream Proxy',
    'Settings used when forwarding requests to the active environment.'
  );
  const proxyToggles = element('div', 'field wide');
  proxySection.append(proxyToggles);
  createToggle(
    proxyToggles,
    devServer,
    'strictSSL',
    'Verify TLS certificates',
    'Reject invalid certificates from HTTPS Ecology servers.'
  );
  createToggle(
    proxyToggles,
    devServer,
    'changeOrigin',
    'Rewrite upstream Host header',
    'Send the Ecology server host instead of the local proxy host.'
  );
}

function renderEnvironmentManagement(): void {
  const toolbar = element('div', 'environment-toolbar');
  toolbar.append(
    element('p', 'detail-description', 'Configure Ecology server connections and local project mappings.')
  );

  const selectedIndex =
    selectedEnvironmentIndex !== null && environments[selectedEnvironmentIndex] ? selectedEnvironmentIndex : null;
  if (selectedIndex === null) {
    toolbar.append(button('Add environment', 'secondary', addEnvironment));
  } else {
    toolbar.append(button('Back to environments', 'secondary', selectEnvironments));
  }
  detail.append(toolbar);

  if (selectedIndex !== null) {
    const editor = element('section', 'environment-editor');
    renderEnvironmentEditor(selectedIndex, editor);
    detail.append(editor);
    return;
  }

  if (environments.length === 0) {
    const empty = element('div', 'empty-detail');
    const copy = element('div');
    copy.append(
      element('strong', '', 'No environments configured'),
      element('span', '', 'Add an environment to begin.')
    );
    empty.append(copy);
    detail.append(empty);
    return;
  }

  detail.append(createEnvironmentTable());
}

function createEnvironmentTable(): HTMLTableElement {
  const table = element('table', 'environment-table');
  const head = element('thead');
  const headerRow = element('tr');
  for (const title of ['Environment', 'Server', 'Local directory', 'Actions']) {
    headerRow.append(element('th', '', title));
  }
  head.append(headerRow);

  const body = element('tbody');
  environments.forEach((environment, index) => {
    const row = element('tr');
    const nameCell = element('td');
    const name = element('strong', 'environment-table-name', environment.name || 'Unnamed environment');
    name.dataset.role = `environment-name-${index}`;
    nameCell.append(name);

    const serverCell = element('td', 'environment-table-secondary', environmentSummary(environment));
    serverCell.dataset.role = `environment-server-${index}`;
    const localDirCell = element('td', 'environment-table-secondary', environment.localDir || './');

    const actionCell = element('td', 'environment-table-actions');
    actionCell.append(
      button('Edit', 'table-action', () => selectEnvironment(index)),
      button('Delete', 'table-action danger-link', () => {
        vscode.postMessage({ command: 'confirmDelete', index, name: environment.name });
      })
    );
    row.append(nameCell, serverCell, localDirCell, actionCell);
    body.append(row);
  });
  table.append(head, body);
  return table;
}

function addEnvironment(): void {
  environments.push({
    name: uniqueEnvironmentName(),
    baseUrl: '',
    username: '',
    password: '',
    localDir: './',
  });
  if (environments.length === 1) activeIndex = 0;
  activeView = 'environments';
  selectedEnvironmentIndex = environments.length - 1;
  markDirty();
  renderNavigation();
  renderDetail();
  detail.querySelector<HTMLInputElement>('[data-property="name"]')?.focus();
}

function renderEnvironmentEditor(index: number, container: HTMLElement): void {
  const environment = environments[index];
  if (!environment) return;

  const editorHeader = element('header', 'environment-editor-header');
  const editorTitle = element('h3', '', `Edit ${String(environment.name || '').trim() || 'Unnamed environment'}`);
  editorTitle.dataset.role = 'environment-editor-title';
  editorHeader.append(editorTitle, element('p', 'detail-subtitle', 'Update the selected environment configuration.'));
  container.append(editorHeader);

  const connectionFields = createSection(
    'Connection',
    'The Ecology server represented by this environment.',
    container
  );
  createField(connectionFields, environment, 'name', 'Name', {
    placeholder: 'Development',
    validate: (value) => required(value, 'Name'),
    onInput: () => updateEnvironmentSummary(environment, index),
  });
  createField(connectionFields, environment, 'baseUrl', 'Server URL', {
    type: 'url',
    placeholder: 'https://ecode.example.com',
    validate: validateServerUrl,
    onInput: () => updateEnvironmentSummary(environment, index),
  });

  const credentialFields = createSection(
    'Credentials',
    'Account used for browsing and publishing eCode resources.',
    container
  );
  createField(credentialFields, environment, 'username', 'Account', {
    placeholder: 'Login account',
    autocomplete: 'username',
    validate: (value) => required(value, 'Account'),
  });
  createField(credentialFields, environment, 'password', 'Password', {
    type: 'password',
    autocomplete: 'current-password',
    validate: (value) => required(value, 'Password'),
    action: (input) => {
      const toggle = button('Show', 'secondary', () => {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        toggle.textContent = showing ? 'Show' : 'Hide';
        input.focus();
      });
      return toggle;
    },
  });

  const projectFields = createSection(
    'Local Project',
    'Location of this environment in the current workspace.',
    container
  );
  createField(projectFields, environment, 'localDir', 'Local directory', {
    wide: true,
    placeholder: './',
    hint: 'Relative paths are resolved from the current workspace.',
    validate: (value) => required(value, 'Local directory'),
    action: () =>
      button('Browse…', 'secondary', () => {
        vscode.postMessage({ command: 'browseLocalDir', index });
      }),
  });
}

function renderDetail(): void {
  detail.replaceChildren();
  if (activeView === 'devServer') renderDevServerDetail();
  else renderEnvironmentManagement();
}

function validationIssue(): ValidationIssue | null {
  const hostError = required(devServer.host, 'Host');
  if (hostError) return { environmentIndex: null, property: 'host', message: hostError };
  const portError = validatePort(devServer.port);
  if (portError) return { environmentIndex: null, property: 'port', message: portError };
  if (devServer.autoOpen) {
    const openPathError = required(devServer.openPath, 'Open path');
    if (openPathError) return { environmentIndex: null, property: 'openPath', message: openPathError };
  }

  const names = new Map<string, number>();
  for (let index = 0; index < environments.length; index++) {
    const environment = environments[index];
    const checks: Array<[keyof EcodeEnvironmentConfig, string]> = [
      ['name', required(environment.name, 'Name')],
      ['baseUrl', validateServerUrl(environment.baseUrl)],
      ['username', required(environment.username, 'Account')],
      ['password', required(environment.password, 'Password')],
      ['localDir', required(environment.localDir, 'Local directory')],
    ];
    for (const [property, message] of checks) {
      if (message) return { environmentIndex: index, property, message };
    }

    const normalizedName = String(environment.name).trim().toLowerCase();
    if (names.has(normalizedName)) {
      return { environmentIndex: index, property: 'name', message: 'Environment names must be unique.' };
    }
    names.set(normalizedName, index);
  }
  return null;
}

function showValidationIssue(issue: ValidationIssue): void {
  activeView = issue.environmentIndex === null ? 'devServer' : 'environments';
  selectedEnvironmentIndex = issue.environmentIndex;
  renderNavigation();
  renderDetail();
  const input = detail.querySelector<HTMLInputElement>(`[data-property="${issue.property}"]`);
  if (input) {
    input.classList.add('invalid');
    input.setAttribute('aria-invalid', 'true');
    const wrapper = input.closest('.field');
    const error = wrapper?.querySelector('.field-error');
    if (error) error.textContent = issue.message;
    input.focus();
  }
  setStatus(issue.message, true);
}

function removeEnvironment(index: number): void {
  if (!environments[index]) return;
  environments.splice(index, 1);
  if (activeIndex === index) activeIndex = Math.min(index, environments.length - 1);
  else if (activeIndex > index) activeIndex -= 1;
  activeIndex = Math.max(0, activeIndex);

  selectedEnvironmentIndex = null;
  markDirty();
  renderNavigation();
  renderDetail();
}

function applyState(message: Extract<EnvironmentSettingsResponse, { type: 'state' | 'saved' }>): void {
  environments = Array.isArray(message.environments)
    ? message.environments.map((environment) => ({ ...environment }))
    : [];
  devServer = { ...message.devServer };
  activeIndex = Number.isInteger(message.activeIndex) ? message.activeIndex : 0;
  activeIndex = Math.max(0, Math.min(activeIndex, Math.max(0, environments.length - 1)));

  if (selectedEnvironmentIndex !== null && !environments[selectedEnvironmentIndex]) {
    selectedEnvironmentIndex = null;
  } else if (message.type === 'state') {
    selectedEnvironmentIndex = null;
  }

  dirty = false;
  setStatus(message.type === 'saved' ? 'Settings saved' : '');
  updateActionState();
  renderNavigation();
  renderDetail();
}

devServerNav.addEventListener('click', selectDevServer);
environmentsNav.addEventListener('click', selectEnvironments);

discardButton.addEventListener('click', () => {
  if (dirty) vscode.postMessage({ command: 'confirmDiscard' });
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const issue = validationIssue();
  if (issue) {
    showValidationIssue(issue);
    return;
  }
  setStatus('Saving…');
  saveButton.disabled = true;
  vscode.postMessage({ command: 'save', environments, devServer, activeIndex });
});

window.addEventListener('message', (event: MessageEvent<EnvironmentSettingsResponse>) => {
  const message = event.data;
  if (message.type === 'state' || message.type === 'saved') {
    applyState(message);
  } else if (message.type === 'localDir' && environments[message.index]) {
    environments[message.index].localDir = message.localDir;
    activeView = 'environments';
    selectedEnvironmentIndex = message.index;
    markDirty();
    renderNavigation();
    renderDetail();
  } else if (message.type === 'deleteConfirmed') {
    removeEnvironment(message.index);
  } else if (message.type === 'discardConfirmed') {
    vscode.postMessage({ command: 'ready' });
  } else if (message.type === 'error') {
    setStatus(message.message, true);
    saveButton.disabled = false;
  }
});

updateActionState();
vscode.postMessage({ command: 'ready' });
