#!/bin/sh
# Creates the `domicile` group, and loads the engine's AppArmor profile where
# AppArmor runs. Without the profile, Ubuntu refuses the engine's sandbox the
# user namespaces it needs, and the engine does not start.
set -e
systemd-sysusers domicile.conf
if command -v aa-enabled >/dev/null && aa-enabled --quiet; then
  apparmor_parser --replace --skip-read-cache --write-cache /etc/apparmor.d/domicile-engine
fi
