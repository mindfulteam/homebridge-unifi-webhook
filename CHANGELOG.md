# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Now available as a pre-release for testing — install with
`npm install -g homebridge-unifi-webhook@beta`. These changes ship as stable in 1.1.0.

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
- `scripts/fire-webhook.mjs` dev helper to post a UniFi-shaped payload at the listener.
- **Settings UI.** The plugin settings are grouped into outgoing (Buttons) and
  incoming (Sensors) sections, and a custom panel generates a sensor's secret and
  shows its ready-to-paste webhook URL with a copy button — no digging in the logs.
- Automated releases: a `release` workflow creates the GitHub release from the
  `package.json` version on push to `main` (using the top CHANGELOG section as
  notes, marked pre-release for `-beta` versions), which then triggers the npm publish.

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

[Unreleased]: https://github.com/mindfulteam/homebridge-unifi-webhook/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/mindfulteam/homebridge-unifi-webhook/releases/tag/v1.0.1
