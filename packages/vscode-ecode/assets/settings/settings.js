(function () {
  const vscode = acquireVsCodeApi();
  const form = document.getElementById('settings-form');
  const detail = document.getElementById('settings-detail');
  const environmentNav = document.getElementById('environment-nav');
  const devServerNav = document.getElementById('dev-server-nav');
  const addEnvironmentButton = document.getElementById('add-environment');
  const discardButton = document.getElementById('discard');
  const saveButton = document.getElementById('save');
  const status = document.getElementById('status');

  let environments = [];
  let devServer = {};
  let activeIndex = 0;
  let selectedEnvironmentIndex = null;
  let dirty = false;

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, className, onClick) {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function updateActionState() {
    discardButton.disabled = !dirty;
    saveButton.disabled = !dirty;
  }

  function markDirty() {
    dirty = true;
    setStatus('Unsaved changes');
    updateActionState();
  }

  function uniqueEnvironmentName() {
    const usedNames = new Set(environments.map((environment) => String(environment.name).trim().toLowerCase()));
    let number = environments.length + 1;
    let name = `Environment ${number}`;
    while (usedNames.has(name.toLowerCase())) name = `Environment ${++number}`;
    return name;
  }

  function environmentSummary(environment) {
    const baseUrl = String(environment.baseUrl || '').trim();
    if (!baseUrl) return 'Server not configured';
    try {
      return new URL(baseUrl).host || baseUrl;
    } catch {
      return baseUrl;
    }
  }

  function selectDevServer() {
    selectedEnvironmentIndex = null;
    renderNavigation();
    renderDetail();
  }

  function selectEnvironment(index) {
    if (!environments[index]) return;
    selectedEnvironmentIndex = index;
    renderNavigation();
    renderDetail();
  }

  function renderNavigation() {
    devServerNav.classList.toggle('selected', selectedEnvironmentIndex === null);
    environmentNav.replaceChildren();

    if (environments.length === 0) {
      environmentNav.append(element('div', 'empty-nav', 'No environments configured'));
      return;
    }

    environments.forEach((environment, index) => {
      const wrapper = element('div', 'environment-item');
      const item = element('button', 'nav-item');
      item.type = 'button';
      item.classList.toggle('selected', selectedEnvironmentIndex === index);
      item.setAttribute('aria-current', selectedEnvironmentIndex === index ? 'page' : 'false');

      const icon = element('span', 'nav-icon', 'E');
      const copy = element('span');
      copy.append(
        element('strong', '', String(environment.name || '').trim() || 'Unnamed environment'),
        element('small', '', environmentSummary(environment))
      );
      item.append(icon, copy);
      item.addEventListener('click', () => selectEnvironment(index));
      wrapper.append(item);

      const isActive = index === activeIndex;
      const activeToggle = element('button', `environment-active-toggle${isActive ? ' active' : ''}`);
      activeToggle.type = 'button';
      activeToggle.title = isActive ? 'Active environment' : `Set ${environment.name || 'environment'} as active`;
      activeToggle.setAttribute('aria-label', activeToggle.title);
      activeToggle.setAttribute('aria-pressed', String(isActive));
      activeToggle.append(element('span', 'active-toggle-dot'));
      activeToggle.addEventListener('click', () => {
        if (index === activeIndex) return;
        activeIndex = index;
        markDirty();
        renderNavigation();
        renderDetail();
      });
      wrapper.append(activeToggle);
      environmentNav.append(wrapper);
    });
  }

  function createDetailHeader(title, subtitle) {
    const header = element('header', 'detail-header');
    const copy = element('div');
    const titleElement = element('h2', '', title);
    const subtitleElement = element('p', 'detail-subtitle', subtitle);
    titleElement.dataset.role = 'detail-title';
    subtitleElement.dataset.role = 'detail-subtitle';
    copy.append(titleElement, subtitleElement);
    const actions = element('div', 'detail-actions');
    header.append(copy, actions);
    detail.append(header);
    return actions;
  }

  function updateEnvironmentSummary(environment) {
    const title = detail.querySelector('[data-role="detail-title"]');
    const subtitle = detail.querySelector('[data-role="detail-subtitle"]');
    if (title) title.textContent = String(environment.name || '').trim() || 'Unnamed environment';
    if (subtitle) subtitle.textContent = environmentSummary(environment);
    renderNavigation();
  }

  function createSection(title, description) {
    const section = element('section', 'form-section');
    section.append(element('h3', '', title));
    if (description) section.append(element('p', 'section-description', description));
    const fields = element('div', 'fields');
    section.append(fields);
    detail.append(section);
    return fields;
  }

  function setFieldError(input, error, message) {
    input.classList.toggle('invalid', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    error.textContent = message || '';
  }

  function createField(fields, model, property, labelText, options = {}) {
    const wrapper = element('div', `field${options.wide ? ' wide' : ''}`);
    const label = element('label', 'field-label', labelText);
    const input = document.createElement('input');
    const error = element('div', 'field-error');
    const inputId = `setting-${property}-${selectedEnvironmentIndex === null ? 'dev' : selectedEnvironmentIndex}`;

    input.id = inputId;
    input.dataset.property = property;
    input.type = options.type || 'text';
    input.value = model[property] ?? '';
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
      model[property] = input.value;
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

  function createToggle(container, model, property, title, description, onChange) {
    const row = element('label', 'toggle-row');
    const copy = element('span', 'toggle-copy');
    copy.append(element('strong', '', title), element('small', '', description));

    const toggle = element('span', 'switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(model[property]);
    input.addEventListener('change', () => {
      model[property] = input.checked;
      markDirty();
      onChange?.();
    });
    toggle.append(input, element('span', 'switch-track'));
    row.append(copy, toggle);
    container.append(row);
  }

  function required(value, label) {
    return String(value).trim() ? '' : `${label} is required.`;
  }

  function validatePort(value) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? '' : 'Port must be an integer between 1 and 65535.';
  }

  function validateServerUrl(value) {
    if (!String(value).trim()) return 'Server URL is required.';
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:' ? '' : 'Use an HTTP or HTTPS URL.';
    } catch {
      return 'Enter a valid server URL.';
    }
  }

  function renderDevServerDetail() {
    createDetailHeader('Local Debug', 'Configure the local proxy and browser startup behavior.');

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

  function renderEnvironmentDetail(index) {
    const environment = environments[index];
    if (!environment) {
      selectedEnvironmentIndex = null;
      renderDetail();
      return;
    }

    const actions = createDetailHeader(
      String(environment.name || '').trim() || 'Unnamed environment',
      environmentSummary(environment)
    );
    actions.append(
      button('Delete', 'danger', () => {
        vscode.postMessage({ command: 'confirmDelete', index, name: environment.name });
      })
    );

    const connectionFields = createSection('Connection', 'The Ecology server represented by this environment.');
    createField(connectionFields, environment, 'name', 'Name', {
      placeholder: 'Development',
      validate: (value) => required(value, 'Name'),
      onInput: () => updateEnvironmentSummary(environment),
    });
    createField(connectionFields, environment, 'baseUrl', 'Server URL', {
      type: 'url',
      placeholder: 'https://ecode.example.com',
      validate: validateServerUrl,
      onInput: () => updateEnvironmentSummary(environment),
    });

    const credentialFields = createSection('Credentials', 'Account used for browsing and publishing eCode resources.');
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

    const projectFields = createSection('Local Project', 'Location of this environment in the current workspace.');
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

  function renderDetail() {
    detail.replaceChildren();
    if (selectedEnvironmentIndex === null) renderDevServerDetail();
    else renderEnvironmentDetail(selectedEnvironmentIndex);
  }

  function validationIssue() {
    const hostError = required(devServer.host, 'Host');
    if (hostError) return { environmentIndex: null, property: 'host', message: hostError };
    const portError = validatePort(devServer.port);
    if (portError) return { environmentIndex: null, property: 'port', message: portError };
    if (devServer.autoOpen) {
      const openPathError = required(devServer.openPath, 'Open path');
      if (openPathError) return { environmentIndex: null, property: 'openPath', message: openPathError };
    }

    const names = new Map();
    for (let index = 0; index < environments.length; index++) {
      const environment = environments[index];
      const checks = [
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

  function showValidationIssue(issue) {
    selectedEnvironmentIndex = issue.environmentIndex;
    renderNavigation();
    renderDetail();
    const input = detail.querySelector(`[data-property="${issue.property}"]`);
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

  function removeEnvironment(index) {
    if (!environments[index]) return;
    environments.splice(index, 1);
    if (activeIndex === index) activeIndex = Math.min(index, environments.length - 1);
    else if (activeIndex > index) activeIndex -= 1;
    activeIndex = Math.max(0, activeIndex);

    if (environments.length === 0) selectedEnvironmentIndex = null;
    else selectedEnvironmentIndex = Math.min(index, environments.length - 1);
    markDirty();
    renderNavigation();
    renderDetail();
  }

  function applyState(message) {
    environments = Array.isArray(message.environments)
      ? message.environments.map((environment) => ({ ...environment }))
      : [];
    devServer = message.devServer && typeof message.devServer === 'object' ? { ...message.devServer } : {};
    activeIndex = Number.isInteger(message.activeIndex) ? message.activeIndex : 0;
    activeIndex = Math.max(0, Math.min(activeIndex, Math.max(0, environments.length - 1)));

    if (selectedEnvironmentIndex !== null && !environments[selectedEnvironmentIndex]) {
      selectedEnvironmentIndex = environments.length ? activeIndex : null;
    } else if (message.type === 'state') {
      selectedEnvironmentIndex = environments.length ? activeIndex : null;
    }

    dirty = false;
    setStatus(message.type === 'saved' ? 'Settings saved' : '');
    updateActionState();
    renderNavigation();
    renderDetail();
  }

  devServerNav.addEventListener('click', selectDevServer);
  addEnvironmentButton.addEventListener('click', () => {
    environments.push({
      name: uniqueEnvironmentName(),
      baseUrl: '',
      username: '',
      password: '',
      localDir: './',
    });
    if (environments.length === 1) activeIndex = 0;
    selectedEnvironmentIndex = environments.length - 1;
    markDirty();
    renderNavigation();
    renderDetail();
    detail.querySelector('[data-property="name"]')?.focus();
  });

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

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'state' || message.type === 'saved') {
      applyState(message);
    } else if (message.type === 'localDir' && environments[message.index]) {
      environments[message.index].localDir = message.localDir;
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
})();
