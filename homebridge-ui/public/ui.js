/* Custom settings UI for homebridge-unifi-webhook. Client-only: uses the
 * window.homebridge API injected by homebridge-config-ui-x. No server, no deps. */
(async () => {
  const DEFAULT_PORT = 51828;

  // Render the standard (grouped) settings form first, so configuration always
  // works even if the enhancements below fail.
  try {
    homebridge.showSchemaForm();
  } catch (error) {
    // Older config-ui-x without showSchemaForm — nothing to fall back to.
  }

  function generateToken() {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function hostForUrl() {
    const host = window.location.hostname || '<homebridge-ip>';
    if (host.startsWith('[') && host.endsWith(']')) {
      return host;
    }
    return host.indexOf(':') !== -1 ? '[' + host + ']' : host;
  }

  function buildUrl(port, token) {
    return 'http://' + hostForUrl() + ':' + (port || DEFAULT_PORT) + '/webhook/' + encodeURIComponent(token);
  }

  async function firstConfig() {
    const configs = await homebridge.getPluginConfig();
    return (configs && configs[0]) ? configs[0] : { platform: 'UniFiWebhook' };
  }

  async function generateFor(index, name) {
    const config = await firstConfig();
    config.sensors = Array.isArray(config.sensors) ? config.sensors : [];
    if (!config.sensors[index]) {
      return;
    }
    config.sensors[index].token = generateToken();
    await homebridge.updatePluginConfig([config]);
    try {
      await homebridge.savePluginConfig();
      homebridge.toast.success('Secret generated', name);
    } catch (error) {
      homebridge.toast.warning('Secret set — fill any required fields, then Save.', name);
    }
    await render();
  }

  async function copyUrl(url, name) {
    try {
      await navigator.clipboard.writeText(url);
      homebridge.toast.success('Webhook URL copied', name);
    } catch (error) {
      homebridge.toast.error('Could not copy automatically — select the URL and copy it.');
    }
  }

  function sensorRow(sensor, index, port) {
    const name = (sensor && sensor.name) ? sensor.name : 'Sensor ' + (index + 1);
    const row = document.createElement('div');
    row.className = 'uw-sensor';

    const label = document.createElement('div');
    label.className = 'uw-name';
    label.textContent = name;
    row.appendChild(label);

    if (sensor && sensor.token) {
      const url = buildUrl(port, sensor.token);
      const wrap = document.createElement('div');
      wrap.className = 'uw-url-row';

      const code = document.createElement('code');
      code.className = 'uw-url';
      code.textContent = url;

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-primary btn-sm';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyUrl(url, name));

      wrap.appendChild(code);
      wrap.appendChild(copyBtn);
      row.appendChild(wrap);
    } else {
      const genBtn = document.createElement('button');
      genBtn.type = 'button';
      genBtn.className = 'btn btn-secondary btn-sm';
      genBtn.textContent = 'Generate secret';
      genBtn.addEventListener('click', async () => {
        genBtn.disabled = true;
        try {
          await generateFor(index, name);
        } catch (error) {
          genBtn.disabled = false;
          homebridge.toast.error('Could not generate a secret.');
        }
      });

      const hint = document.createElement('span');
      hint.className = 'uw-hint';
      hint.textContent = 'No secret yet — generate one to get a copyable URL.';

      row.appendChild(genBtn);
      row.appendChild(hint);
    }
    return row;
  }

  async function render() {
    const container = document.getElementById('uw-list');
    if (!container) {
      return;
    }
    let config;
    try {
      config = await firstConfig();
    } catch (error) {
      return;
    }
    const sensors = Array.isArray(config.sensors) ? config.sensors : [];
    const port = config.port || DEFAULT_PORT;

    container.innerHTML = '';
    if (sensors.length === 0) {
      const empty = document.createElement('em');
      empty.className = 'uw-hint';
      empty.textContent = 'Add a sensor below to get its webhook URL here.';
      container.appendChild(empty);
      return;
    }
    sensors.forEach((sensor, index) => container.appendChild(sensorRow(sensor, index, port)));
  }

  homebridge.addEventListener('configChanged', () => {
    render().catch(() => {});
  });

  await render();
})();
