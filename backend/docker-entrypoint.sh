#!/bin/sh
set -e

# Bind-mounting /home/mike from the host replaces image contents; ensure
# LibreOffice/fontconfig cache dirs exist and are owned by the app user.
mkdir -p \
  /home/mike/.cache/dconf \
  /home/mike/.cache/fontconfig \
  /home/mike/.config
chown -R mike:nodejs /home/mike

AGENT_LOG_DIR="${AGENT_LOG_DIR:-/app/logs}"
mkdir -p "$AGENT_LOG_DIR"
chown -R mike:nodejs "$AGENT_LOG_DIR"

exec gosu mike "$@"
