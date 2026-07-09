#!/usr/bin/env bash
# Build, pack, and copy an unpublished build of the plugin to a Raspberry Pi
# (or any SSH host) for testing. Prints the install commands for both
# Homebridge setup types, then opens an SSH session so you can paste them.
#
#   npm run deploy:pi -- pi@homebridge.local
set -euo pipefail

TARGET="${1:?usage: deploy-pi.sh <user@host>   e.g. pi@homebridge.local}"

npm run build --silent
TARBALL="homebridge-unifi-webhook-$(node -p "require('./package.json').version").tgz"
npm pack --silent >/dev/null
scp "$TARBALL" "$TARGET:/tmp/$TARBALL"

cat <<EOF

Copied $TARBALL to $TARGET:/tmp/

On the Pi — official Homebridge image / apt install (hb-service):
  sudo hb-shell
  cd /var/lib/homebridge && npm install /tmp/$TARBALL
  exit
  sudo hb-service restart
  sudo hb-service logs

On a manual global-npm Homebridge install instead:
  sudo npm install -g --unsafe-perm /tmp/$TARBALL
  sudo systemctl restart homebridge

Opening an SSH session to $TARGET (Ctrl-C to skip)…
EOF

exec ssh -t "$TARGET"
