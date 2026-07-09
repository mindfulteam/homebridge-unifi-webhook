# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-07-08

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

[Unreleased]: https://github.com/mindfulteam/homebridge-unifi-webhook/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mindfulteam/homebridge-unifi-webhook/releases/tag/v1.0.0
