#!/bin/sh
set -e

# Bind-mounting /home/mike from the host replaces image contents; ensure
# LibreOffice/fontconfig cache dirs exist and are owned by the app user.
mkdir -p \
  /home/mike/.cache/dconf \
  /home/mike/.cache/fontconfig \
  /home/mike/.config
chown -R mike:nodejs /home/mike

exec gosu mike "$@"
