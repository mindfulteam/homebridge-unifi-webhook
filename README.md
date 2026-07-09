<p align="center">
<img src="https://media.stefanh.co/github/cover.png" alt="homebridge-unifi-webhook — Unifi Protect Webhook Button" width="100%">
</p>

# homebridge-unifi-webhook

[![npm version](https://img.shields.io/npm/v/homebridge-unifi-webhook)](https://www.npmjs.com/package/homebridge-unifi-webhook)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-unifi-webhook)](https://www.npmjs.com/package/homebridge-unifi-webhook)
[![Build and Test](https://github.com/mindfulteam/homebridge-unifi-webhook/actions/workflows/build.yml/badge.svg)](https://github.com/mindfulteam/homebridge-unifi-webhook/actions/workflows/build.yml)
[![License](https://img.shields.io/npm/l/homebridge-unifi-webhook)](LICENSE)

Bridge HomeKit and [UniFi Alarm Manager](https://help.ui.com/hc/en-us/articles/27721287753239) webhooks **in both directions**.

- **HomeKit → UniFi ([buttons](#buttons-trigger-unifi-from-homekit)).** Flip a switch — or ask Siri, or let a HomeKit automation do it — and the plugin fires the matching Alarm Manager webhook: sound a siren, flash floodlights, lock down a gate. The switch resets itself, like a doorbell button.
- **UniFi → HomeKit ([sensors](#sensors-trigger-homekit-from-unifi)).** Point an Alarm Manager webhook at the plugin and a HomeKit **sensor** flips when it fires — so a UniFi motion, person, or doorbell event can trigger any Home app automation or scene.

Everything is configurable from the Homebridge UI, with zero runtime dependencies.

- **Two-way** — outgoing button switches and incoming sensors, side by side, in one plugin.
- **Sensors, not switches, for triggers** — HomeKit only lets a *sensor* start an automation, never a plain switch, so incoming webhooks surface as Contact / Motion / Occupancy sensors.
- **Momentary by design** — a webhook is an event, not a state. Switches and sensors auto-reset after a configurable delay; a button snaps back instantly when a trigger fails so you can see something went wrong.
- **Authenticated incoming webhooks** — each sensor's URL carries an unguessable secret token, with an optional shared-secret header on top.
- **Zero runtime dependencies** — installs in seconds, nothing to audit but this plugin.
- **Self-signed friendly** — works with the self-signed certificate every UniFi console serves on the LAN.
- **Secrets stay out of the logs** — API keys never logged, tokens masked; the one exception is each sensor's ready-to-paste URL, printed once at startup.

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

Want to try upcoming features early? Install the latest pre-release (in the Homebridge UI, enable *pre-release versions* on the plugin, or from a terminal):

```shell
npm install -g homebridge-unifi-webhook@beta
```

## Buttons: trigger UniFi from HomeKit

Each button is a momentary HomeKit switch. Turning it on fires an outgoing Alarm Manager webhook, then the switch resets itself. Prefer to go the other way — UniFi driving HomeKit? See [Sensors](#sensors-trigger-homekit-from-unifi).

### UniFi setup

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
| `buttons` | array | `[]` | Outgoing button switches — see [Button options](#button-options). |
| `sensors` | array | `[]` | Incoming-webhook sensors — see [Sensors](#sensors-trigger-homekit-from-unifi). |
| `allowSelfSigned` | boolean | `true` | Accept the console's self-signed TLS certificate (buttons). Disable only if your console has a trusted certificate. |
| `timeoutSeconds` | integer | `10` | How long to wait for the console to answer, in seconds (buttons; 1–60). |
| `resetDelayMs` | integer | `1000` | How long a button switch stays on after a successful trigger (100–60000). |
| `port` | integer | `51828` | Port the incoming-webhook listener binds to. Only started when sensors exist. |
| `bindHost` | string | `0.0.0.0` | Interface the listener binds to. All interfaces by default, so the console can reach it. |
| `webhookSecret` | string | — | Optional shared secret required on incoming webhooks, on top of each sensor's token. |

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

## Sensors: trigger HomeKit from UniFi

Point a UniFi Alarm Manager **webhook action** at this plugin and it flips a HomeKit **sensor** — so a UniFi event (motion, person, vehicle, doorbell ring, …) can start any Home app automation or scene. A plain switch can't be an automation *trigger* in the Home app; a sensor can, which is why incoming webhooks surface as **Contact**, **Motion**, or **Occupancy** sensors. Each fires momentarily and auto-resets, exactly like a real motion sensor.

### Add a sensor

1. Add a sensor in the plugin settings: give it a **name** and a stable **ID** (e.g. `doorbell`), and pick a **sensor type** (contact is the default).
2. Restart Homebridge and open the log. The plugin prints a ready-to-paste URL for each sensor, once:

   ```text
   Sensor "Doorbell Pressed" (contact) — paste into the UniFi Alarm Manager webhook action: http://192.168.1.50:51828/webhook/Xy…long-secret…
   ```

   That URL contains the sensor's secret token — treat it like a password.
3. In **Protect → Alarm Manager**, create an alarm for the event you care about, add a **Webhook** action, and paste the URL. Leave the method as the default (GET) or set POST — both work.

When the alarm fires, the sensor flips to *detected* and your HomeKit automations run.

> **Reachability.** The listener binds to all interfaces on port `51828` by default. Your UniFi console must be able to reach `http://<homebridge-host>:<port>` on your LAN — open that port on the Homebridge host's firewall if needed, and make sure it doesn't clash with another service. Keep it on a trusted network; don't expose it to the internet.

### Configuration

```json
{
  "platforms": [
    {
      "platform": "UniFiWebhook",
      "name": "UniFi Webhook",
      "port": 51828,
      "sensors": [
        { "name": "Doorbell Pressed", "id": "doorbell", "sensorType": "contact" },
        { "name": "Driveway Motion", "id": "driveway", "sensorType": "motion" }
      ]
    }
  ]
}
```

### Sensor options

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | string | — | **Required.** The sensor name in HomeKit. Rename any time — automations survive. |
| `id` | string | — | Recommended. Anchors the accessory identity and lets the plugin generate and remember the secret URL for you. Required unless you set `token`. |
| `sensorType` | `contact` \| `motion` \| `occupancy` | `contact` | Which sensor to expose. All three are valid automation triggers. |
| `resetDelayMs` | integer | `5000` | How long the sensor reads *detected* before auto-resetting (100–60000). |
| `token` | string | — | Advanced. The secret path segment of the URL. Leave empty to auto-generate (needs an `id`); set it only to control the URL. Use a long random string. |

### Authentication

Every incoming request must present the sensor's **secret token** as the last path segment of the URL (`…/webhook/<token>`). Tokens are auto-generated with ~192 bits of entropy and persisted, so the URL stays stable across restarts. An unknown or missing token gets a flat `404`.

For a second factor, set a platform-level **`webhookSecret`** and add it to the UniFi webhook action's **custom headers** as either `Authorization: Bearer <secret>` or `X-Webhook-Token: <secret>`. The plugin compares it in constant time and rejects a bad or missing secret with `401`.

### Renaming & identity

Like buttons, a sensor's identity is anchored to its **`id`** (or its explicit `token`, if you set one), never its name — so rename freely. Changing a sensor's `sensorType` keeps the accessory but swaps its service, which resets automations tied to the old sensor; pick the type up front.

## Siri and automations

Buttons are plain HomeKit switches and sensors are real HomeKit sensors, so everything just works:

- *"Hey Siri, turn on Sound Alarm."* (button)
- HomeKit automation *into* UniFi: *When the front door opens after 11 pm → turn on Flash Floodlights.*
- HomeKit automation *from* UniFi: *When Driveway Motion detects → turn on the porch light.* — a UniFi event driving HomeKit.
- Scenes: include any button in a scene.

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
| Sensor never triggers | The console can't reach the listener — check the `port` is open on the Homebridge host and reachable from UniFi, and that the pasted URL matches the one printed in the log. |
| `Rejected webhook (404)` in the log | Wrong or rotated token in the URL — re-copy the sensor URL printed at startup. |
| `Rejected webhook (401)` in the log | A `webhookSecret` is set but the UniFi custom header is missing or wrong. |
| `port … already in use` in the log | Another service owns that port — change `port` in the plugin settings. |

## Security notes

- The API key lives in Homebridge's `config.json` like all plugin credentials — protect that file accordingly.
- The plugin never logs API keys, and masks webhook ids in logged URLs.
- `allowSelfSigned` (default on) skips TLS certificate verification for outgoing button requests. That is the pragmatic reality of talking to a UniFi console by IP on your LAN; disable it if you've set up a trusted certificate.
- **Incoming webhooks are authenticated** by an unguessable per-sensor token (~192-bit) in the URL, optionally plus a shared-secret header compared in constant time. Unknown tokens get a flat `404`, bad secrets a `401`.
- The listener is a **plain-HTTP LAN service** — keep it on a trusted network and never port-forward it to the internet. The token is the credential; treat each sensor URL like a password.
- Each sensor's full URL is printed **once at startup** so you can copy it into UniFi; every per-request log line masks it. This is the single, intentional exception to "secrets never hit the logs".
- No analytics, no tracking, no network calls other than the webhooks you configure.

## Development

```shell
git clone https://github.com/mindfulteam/homebridge-unifi-webhook.git
cd homebridge-unifi-webhook
npm ci
npm test                              # vitest unit suites
node scripts/mock-webhook.mjs &       # outgoing: local target for buttons (terminal 1)
npm run watch                         # dev Homebridge on test/hbConfig (terminal 2)
node scripts/fire-webhook.mjs --token dev-doorbell-token-change-me   # incoming: flip a sensor
```

`npm run watch` builds, then starts a local Homebridge (`-U ./test/hbConfig -P . -D`) that loads the plugin from the working tree and restarts on changes. The bundled `test/hbConfig/config.json` wires two buttons to the mock webhook server and two sensors to the built-in listener on port `51828`; pair the bridge from the Home app (PIN `031-45-154`). Click the buttons to hit the mock server, and run `scripts/fire-webhook.mjs` to flip a sensor (add `--method GET`, or `--secret <s>` if you set a `webhookSecret`). `scripts/mock-webhook.mjs --status 500` and `--delay 15000` exercise the button failure and timeout paths.

### Releasing (maintainers)

Versions follow [SemVer](https://semver.org). Publishing is tokenless — the **Publish to npm** workflow authenticates to npm over OIDC ([trusted publishing](https://docs.npmjs.com/trusted-publishers)) and attaches provenance. The workflow reads `package.json` and picks the npm [dist-tag](https://docs.npmjs.com/adding-dist-tags-to-packages) from the version: a plain version goes to `latest`, a pre-release (`-beta.N`) goes to `beta`. So a beta can never accidentally land on `latest`.

**Stable release.** Bump the version (`npm version patch|minor|major`) and update the [CHANGELOG](CHANGELOG.md) on `main`, then cut a GitHub release: `gh release create vX.Y.Z --notes …`. That triggers the workflow, which publishes to `latest`.

**Beta / pre-release.** Cut a pre-release version (`npm run version:beta` → `X.Y.Z-beta.N`; for the first beta of a new line use `npm version preminor --preid=beta` or `prepatch --preid=beta`) and push it. Then publish it either way:

- **Actions → Publish to npm → Run workflow** (a `workflow_dispatch`, no GitHub release needed), or
- `gh release create vX.Y.Z-beta.N --prerelease --notes …`.

Because the version carries `-beta`, the workflow publishes under the `@beta` tag. Testers install it with `npm install -g homebridge-unifi-webhook@beta`, and Homebridge UI offers it when *pre-release versions* are enabled for the plugin. To publish a beta by hand instead, `npm publish --tag beta` from a `-beta` version does the same thing. When the beta is solid, release the matching stable version to move `latest` forward.

## License

[Apache-2.0](LICENSE)
