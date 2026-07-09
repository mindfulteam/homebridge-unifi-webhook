# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-07-09

### Added

- **Double-press confirmation for buttons (safety guard).** Set
  `requireDoublePress: true` on a button to require two presses within a short
  window before its webhook fires — protection against an accidental single tap
  on destructive actions like a siren. Press the switch once to arm it (it stays
  on to show it is waiting), then press again within the window to fire; the
  window is configurable per button via `doublePressWindowSeconds` (default `3`,
  range 1–30). A single activation only arms the button, so a scene, automation,
  or Siri command that switches it on can arm it but will not fire it.

### Notes

- Fully backward compatible — buttons default to single-press behavior.

## [1.1.0] - 2026-07-09

### Added

- **Incoming webhook sensors (UniFi → HomeKit).** A new `sensors` array exposes
  Contact, Motion, or Occupancy sensors that flip to "detected" when the UniFi
  Protect Alarm Manager posts to the plugin, then auto-reset — so Home app
  automations can react to UniFi events (a plain switch cannot be an automation
  trigger, a sensor can).
- Built-in zero-dependency HTTP listener (configurable `port`, default `51828`;
  optional `bindHost`), started only when at least one sensor is configured.
- Per-sensor authentication: a high-entropy secret token in the webhook URL path
  — auto-generated and persisted (the ready-to-paste URL is printed once at
  startup), or set explicitly. Optional shared-secret header (`Authorization:
  Bearer …` or `X-Webhook-Token: …`) as a second factor, compared in constant time.
- Rename-safe sensor identity (`id`, otherwise the token), matching the button
  model; per-sensor `sensorType` and `resetDelayMs`.
- Request hardening on the listener: GET/POST only, 64 KiB body cap, request
  timeouts, and graceful handling of `EADDRINUSE`/`EACCES` (Homebridge stays up).
- **Settings UI.** Plugin settings open in a custom panel with **Settings**,
  **Webhooks**, and **Support** tabs (plus cover art). The Webhooks tab shows
  every sensor's ready-to-paste webhook URL — including auto-generated secrets
  once the sensor has started — with copy and generate buttons and an editable
  host, so nothing needs digging out of the logs. Settings stay grouped into
  outgoing (Buttons) and incoming (Sensors) sections.

### Changed

- The plugin's display name is now **UniFi Protect Webhook**. The npm package
  (`homebridge-unifi-webhook`) and the `"platform": "UniFiWebhook"` config value
  are unchanged — no action needed.

### Fixed

- During the 1.1.0 betas the custom settings panel never appeared: the schema
  didn't declare the custom UI, so the Homebridge UI showed only the plain
  settings form. The panel now opens as intended.

### Notes

- Fully backward compatible — existing `buttons` behavior is unchanged.

## [1.0.1] - 2026-07-08

### Added

- Initial release.
- One momentary HomeKit switch per configured button; turning it on fires the
  configured UniFi Protect Alarm Manager webhook and the switch auto-resets.
- Support for Integration API webhooks (`POST` + `X-API-KEY`) and legacy
  `/proxy/protect/api/webhook/<id>` URLs (`GET`, no key).
- Global API key with per-button overrides.
- Self-signed certificate support (`allowSelfSigned`, on by default) with
  per-request TLS isolation.
- Rename-safe accessory identity (`id` or `url`, never the name), including
  survival of misconfigured URLs when an `id` anchors the button.
- Configurable request timeout and switch reset delay.
- Full configuration UI (`config.schema.json`) for the Homebridge UI.
- Secret hygiene: API keys never logged, webhook ids masked in logged URLs.

[1.1.1]: https://github.com/mindfulteam/homebridge-unifi-webhook/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/mindfulteam/homebridge-unifi-webhook/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/mindfulteam/homebridge-unifi-webhook/releases/tag/v1.0.1
