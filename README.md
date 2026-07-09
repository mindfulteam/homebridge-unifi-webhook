<p align="center">
<img src="https://raw.githubusercontent.com/mindfulteam/homebridge-unifi-webhook/main/assets/icon.png" width="120" alt="homebridge-unifi-webhook icon">
</p>

# homebridge-unifi-webhook

[![npm version](https://img.shields.io/npm/v/homebridge-unifi-webhook)](https://www.npmjs.com/package/homebridge-unifi-webhook)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-unifi-webhook)](https://www.npmjs.com/package/homebridge-unifi-webhook)
[![Build and Test](https://github.com/mindfulteam/homebridge-unifi-webhook/actions/workflows/build.yml/badge.svg)](https://github.com/mindfulteam/homebridge-unifi-webhook/actions/workflows/build.yml)
[![License](https://img.shields.io/npm/l/homebridge-unifi-webhook)](LICENSE)

Momentary HomeKit switches that trigger [UniFi Alarm Manager](https://help.ui.com/hc/en-us/articles/27721287753239) webhooks.

Flip a switch in the Home app — or ask Siri, or let a HomeKit automation do it — and the plugin fires the matching UniFi Protect webhook: sound a siren, flash camera floodlights, lock down a gate, or run any other Alarm Manager automation. The switch flips back off by itself, like a doorbell button.

- **One or many buttons** — each button becomes its own HomeKit switch; add, remove, and rename them freely in the Homebridge UI.
- **Momentary by design** — a webhook trigger is an event, not a state. Switches auto-reset after a configurable delay (default 1 s), and snap back instantly when a trigger fails so you can see something went wrong.
- **Zero runtime dependencies** — installs in seconds, nothing to audit but this plugin.
- **Self-signed friendly** — works with the self-signed certificate every UniFi console serves on the LAN.
- **Secrets stay out of the logs** — API keys are never logged, and webhook ids in URLs are masked.

## Requirements

| | |
|---|---|
| Homebridge | `^1.9.0` or `^2.0.0` |
| Node.js | 22 or 24 (current LTS versions) |
| UniFi Protect | A console with **Alarm Manager** (UniFi OS 4+ / Protect 5+) |

## Installation

Search for **UniFi Webhook** on the *Plugins* page of the [Homebridge UI](https://github.com/homebridge/homebridge-config-ui-x) and click *Install* — then configure it right from the plugin settings.

Or from a terminal:

```shell
npm install -g homebridge-unifi-webhook
```

## UniFi setup

You need two things from your UniFi console: an **API key** and a **webhook URL**.

1. **Create an API key** — in the UniFi console, open **Settings → Control Plane → Integrations** and create an API key. Copy it somewhere safe; UniFi shows it only once.
2. **Create the webhook alarm** — in **Protect → Alarm Manager**, add an alarm, pick **Webhook** as its *trigger*, and configure the *actions* the alarm should perform (siren, floodlight, notification, …).
3. **Copy the webhook URL** — the trigger shows a URL like:

   ```text
   https://<console-ip>/proxy/protect/integration/v1/alarm-manager/webhook/<webhook-id>
   ```

> **Legacy webhooks.** Older Protect versions generate `https://<console-ip>/proxy/protect/api/webhook/<id>` URLs instead. Those work too: set the button's method to `GET` and leave the API key empty.

## Configuration

Use the plugin settings screen in the Homebridge UI (recommended), or add the platform to your `config.json` directly:

```json
{
  "platforms": [
    {
      "platform": "UniFiWebhook",
      "name": "UniFi Webhook",
      "apiKey": "your-unifi-api-key",
      "buttons": [
        {
          "name": "Sound Alarm",
          "url": "https://192.168.1.1/proxy/protect/integration/v1/alarm-manager/webhook/abcd1234"
        },
        {
          "name": "Flash Floodlights",
          "url": "https://192.168.1.1/proxy/protect/integration/v1/alarm-manager/webhook/efgh5678"
        }
      ]
    }
  ]
}
```

### Platform options

| Option | Type | Default | Description |
|---|---|---|---|
| `platform` | string | — | Must be `UniFiWebhook`. |
| `name` | string | `UniFi Webhook` | Platform name used in the Homebridge logs. |
| `apiKey` | string | — | Sent as the `X-API-KEY` header with every request. Required for Integration API URLs. |
| `buttons` | array | `[]` | The buttons to expose — see below. |
| `allowSelfSigned` | boolean | `true` | Accept the console's self-signed TLS certificate. Disable only if your console has a trusted certificate. |
| `timeoutSeconds` | integer | `10` | How long to wait for the console to answer (1–60). |
| `resetDelayMs` | integer | `1000` | How long a switch stays on after a successful trigger (100–60000). |

### Button options

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | string | — | **Required.** The switch name in HomeKit. |
| `url` | string | — | **Required.** The webhook URL copied from Alarm Manager. |
| `method` | `POST` \| `GET` | `POST` | `POST` for Integration API URLs, `GET` for legacy URLs. |
| `apiKey` | string | — | Per-button override of the global API key. |
| `id` | string | — | Optional stable identity anchor — see [Renaming buttons](#renaming-buttons--accessory-identity). |

## Behavior details

### Momentary switches

Turning a switch on fires the webhook once. On success the switch stays on for `resetDelayMs`, then flips off. On failure it snaps off almost immediately and the log explains what went wrong — so a switch that won't stay on is your visual cue to check the logs. Turning a switch off manually never sends anything: an alarm trigger can't be un-fired.

Rapid double-taps while a request is still in flight are coalesced into one trigger. After a cycle completes, pressing again fires again.

### Renaming buttons & accessory identity

A button's HomeKit identity is anchored to its **`id` if set, otherwise its `url`** — deliberately *not* its name. Rename a button any time; its room assignment, scenes, and automations survive.

Two consequences worth knowing:

- **Changing a button's `url`** (without an `id`) creates a *new* accessory and removes the old one — automations are lost. If you expect to rotate webhook URLs (e.g. recreating alarms), give the button an `id` **before its first launch**; then the URL can change freely.
- **Adding or changing an `id` later** changes the identity too, and re-creates the accessory. Pick your `id`s up front.

Two buttons may share one URL if each has a distinct `id`.

### Failure handling

Every failure is logged with a hint: `401/403` → check the API key, `404` → the alarm/webhook was probably deleted, timeouts and connection errors → check the console address, certificate rejections → enable `allowSelfSigned`. A misconfigured button (invalid URL) that has an `id` keeps its accessory alive and fails loudly on presses until you fix the URL, instead of silently vanishing from HomeKit.

## Siri and automations

Each button is a plain HomeKit switch, so everything just works:

- *"Hey Siri, turn on Sound Alarm."*
- HomeKit automation: *When the front door opens after 11pm → turn on Flash Floodlights.*
- Scenes: include a button in any scene.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Switch snaps off immediately | The trigger failed — check the Homebridge log for the reason and hint. |
| `HTTP 401` in the log | Missing or wrong API key. Create one under **Settings → Control Plane → Integrations**. |
| `HTTP 404` in the log | The webhook id no longer exists — re-copy the URL from Alarm Manager. |
| Certificate errors with `allowSelfSigned: false` | Your console serves a self-signed certificate — re-enable `allowSelfSigned`. |
| Timeouts | Wrong console IP, VLAN/firewall in the way, or the console is down. |
| A button disappeared from HomeKit | Its config entry was removed or its `url`/`id` (= identity) changed. See [identity](#renaming-buttons--accessory-identity). |
| Renamed in the Home app, name came back | Names set in the plugin config win on restart. Rename in the plugin settings instead. |

## Security notes

- The API key lives in Homebridge's `config.json` like all plugin credentials — protect that file accordingly.
- The plugin never logs API keys, and masks webhook ids in logged URLs.
- `allowSelfSigned` (default on) skips TLS certificate verification for webhook requests. That is the pragmatic reality of talking to a UniFi console by IP on your LAN; disable it if you've set up a trusted certificate.
- No analytics, no tracking, no network calls other than the webhooks you configure.

## Development

```shell
git clone https://github.com/mindfulteam/homebridge-unifi-webhook.git
cd homebridge-unifi-webhook
npm ci
npm test                              # vitest unit suites
node scripts/mock-webhook.mjs &       # local webhook target (terminal 1)
npm run watch                         # dev Homebridge on test/hbConfig (terminal 2)
```

`npm run watch` builds, then starts a local Homebridge (`-U ./test/hbConfig -P . -D`) that loads the plugin from the working tree and restarts on changes. The bundled `test/hbConfig/config.json` points two buttons at the mock webhook server; pair the bridge from the Home app (PIN `031-45-154`) to click them. `scripts/mock-webhook.mjs --status 500` and `--delay 15000` exercise the failure and timeout paths.

### Releasing (maintainers)

Versions follow [SemVer](https://semver.org): `npm version patch|minor|major`, push with tags, then publish a GitHub release with notes mirroring the [CHANGELOG](CHANGELOG.md) — the release triggers the npm publish workflow (provenance included). For pre-releases: `npm version prepatch --preid beta && npm publish --tag beta`, installable via `npm install -g homebridge-unifi-webhook@beta`.

## License

[Apache-2.0](LICENSE)
