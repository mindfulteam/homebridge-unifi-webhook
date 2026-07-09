import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PLATFORM_NAME, PLUGIN_NAME, PLUGIN_VERSION } from '../src/settings.js';

const schema = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const indexHtml = readFileSync(new URL('../homebridge-ui/public/index.html', import.meta.url), 'utf8');

describe('config.schema.json', () => {
  it('declares the custom UI', () => {
    expect(schema.customUi).toBe(true);
  });

  it('stays aligned with the platform identity', () => {
    expect(schema.pluginAlias).toBe(PLATFORM_NAME);
    expect(schema.pluginType).toBe('platform');
    expect(schema.singular).toBe(true);
  });
});

describe('package.json', () => {
  it('ships the custom UI and schema', () => {
    expect(pkg.files).toEqual(expect.arrayContaining(['dist', 'homebridge-ui', 'config.schema.json']));
  });

  it('matches the runtime identity constants', () => {
    expect(pkg.name).toBe(PLUGIN_NAME);
    expect(pkg.version).toBe(PLUGIN_VERSION);
  });
});

describe('homebridge-ui/public/index.html', () => {
  it('is a fragment — config-ui-x supplies the document shell', () => {
    expect(indexHtml).not.toMatch(/<html|<head|<body/i);
  });

  it('contains every element ui.js binds to', () => {
    const ids = [
      'uw-cover-img',
      'uw-tab-settings',
      'uw-tab-webhooks',
      'uw-tab-support',
      'uw-panel-webhooks',
      'uw-panel-support',
      'uw-host',
      'uw-secret-note',
      'uw-list',
    ];
    for (const id of ids) {
      expect(indexHtml).toContain(`id="${id}"`);
    }
    expect(indexHtml).toContain('<script type="module" src="ui.js"></script>');
  });
});
