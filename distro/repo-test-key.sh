#!/usr/bin/env bash
# Prints a new signing key, armored and without a passphrase, for building
# test repositories with `distro/repo.sh`. Releases use the real key.
set -euo pipefail

GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
trap 'gpgconf --kill all; rm -rf "$GNUPGHOME"' EXIT
gpg --batch --quiet --passphrase '' \
  --quick-gen-key "Domicile test repository <test@domicile.invalid>" ed25519 sign never
gpg --batch --armor --export-secret-keys
