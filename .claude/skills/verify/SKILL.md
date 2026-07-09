---
name: verify
description: Build, run, and drive this Homebridge plugin (runtime + Config UI X custom settings UI) to verify changes end-to-end.
---

# Verify homebridge-unifi-webhook end-to-end

## Runtime surface (webhook listener + logs)

```bash
npm run build && npm pack --silent --pack-destination /tmp
rm -rf /tmp/uw-verify && mkdir -p /tmp/uw-verify/storage && cd /tmp/uw-verify
npm init -y >/dev/null && npm install homebridge homebridge-config-ui-x /tmp/homebridge-unifi-webhook-<version>.tgz
```

Storage `config.json`: bridge block + `{"platform":"config","name":"Config","port":8581,"auth":"none"}` + a `UniFiWebhook` platform with one explicit-token sensor and one id-only sensor (auto token), `"port": 51899`.

```bash
./node_modules/.bin/homebridge -U ./storage > hb.log 2>&1 & echo $! > hb.pid
```

Expect in `hb.log`: `Adding sensor`, per-sensor `paste into the UniFi Alarm Manager webhook action: http://…/webhook/<token>`, `Webhook listener ready`. Drive: `curl` the logged URLs (→ 200 + "webhook received" log), wrong token → 404, DELETE → 405. Auto tokens persist in `storage/accessories/cachedAccessories` (`context.key/token/tokenSource`).

## Config UI X surface (custom settings UI)

**Gotcha:** config-ui-x v5 does NOT serve the web UI when homebridge loads it as a platform — start it separately:

```bash
node node_modules/homebridge-config-ui-x/dist/bin/standalone.js -U ./storage -P ./node_modules > uix.log 2>&1 & echo $! > uix.pid
```

First run needs the setup wizard even with `"auth":"none"` (noauth 500s otherwise):

```bash
curl -s -X POST localhost:8581/api/setup-wizard/create-first-user -H 'Content-Type: application/json' \
  -d '{"username":"verify","password":"verify-pass-1","passwordConfirm":"verify-pass-1","name":"Verify"}'
TOKEN=$(curl -s -X POST localhost:8581/api/auth/noauth -d '{}' -H 'Content-Type: application/json' | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
```

API checks: `/api/plugins` (displayName/version), `/api/plugins/config-schema/homebridge-unifi-webhook` (`customUi: true`), `/api/plugins/settings-ui/homebridge-unifi-webhook/{index.html,ui.js,lib.js}?token=$TOKEN` (200, `application/javascript` for modules; config-ui-x wraps index.html in its own document shell and sends an **empty CSP** on this route — hotlinked images are fine).

## Browser drive (pixels)

`npm i playwright-core` in the scratch dir; launch the cached Chromium (`~/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`) headless. Flow: `goto /plugins` → card "UniFi Protect Webhook" → button `Plugin Actions` → `Plugin Config` → modal. Custom UI lives in the modal `iframe` (`page.frameLocator('iframe')`); the schema form renders in the iframe BELOW the custom content only on the Settings tab. Assert: `#uw-tab-webhooks` click → `.uw-url` texts match the `hb.log` URLs (auto token included); `#uw-host` fill re-renders URLs live and never touches `storage/config.json`; Copy → toast + clipboard (grant `clipboard-read/write`); `#uw-panel-support a` links. Screenshot the modal per tab.

## Cleanup

```bash
kill $(cat /tmp/uw-verify/hb.pid /tmp/uw-verify/uix.pid) 2>/dev/null
```

The pid files survive across shell invocations; kill from them, not by port — port-based kills can hit an unrelated local Config UI X on 8581. If the pid files are lost, fall back to `lsof -nP -iTCP:51899 -iTCP:51999 -sTCP:LISTEN -t | xargs kill` (scratch-only ports) and handle 8581 manually. (pkill by `/tmp/uw-verify` misses these processes — their argv uses relative paths.)
