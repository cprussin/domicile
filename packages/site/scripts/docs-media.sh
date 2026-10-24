#!/usr/bin/env bash
# Captures the screenshots and videos in docs/media, on the GPU.
#
#   packages/site/scripts/docs-media.sh            # every scene
#   packages/site/scripts/docs-media.sh hero       # one scene
#
# Each scene is `docs-media/scenes/<name>.sh` beside this script, run in its
# own nested sway (`under-wayland.sh`) with the helpers in `docs-media/lib.sh`.
# Needs a DRM render node: without one the compositor draws shared-memory
# clients blank. CI runs it on `crux` (`.github/workflows/docs-media.yml`).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCENES="$ROOT/packages/site/scripts/docs-media/scenes"
MEDIA="$ROOT/docs/media"

if [ $# -gt 0 ]; then
  names=("$@")
else
  names=()
  for scene in "$SCENES"/*.sh; do
    names+=("$(basename "$scene" .sh)")
  done
fi

for name in "${names[@]}"; do
  [ -f "$SCENES/$name.sh" ] || { echo "no scene $name in $SCENES" >&2; exit 1; }
  echo "scene $name"
  # In /tmp, since the engine puts a socket beside its profile and a deep
  # $TMPDIR passes the 107-byte socket path limit.
  SCENE_TMP="$(mktemp -d /tmp/domicile-media.XXXXXX)"
  # The scene's output size is the nested sway's output.
  OUTPUT_MODE="${OUTPUT_MODE:-1920x1200@60Hz}" \
  ROOT="$ROOT" MEDIA="$MEDIA" SCENE_TMP="$SCENE_TMP" SCENE_DIR="$SCENES/$name" \
    "$ROOT/packages/domicile-engine/scripts/under-wayland.sh" "$ROOT" \
    bash -euo pipefail -c '
      . "$ROOT/packages/site/scripts/docs-media/lib.sh"
      trap scene_cleanup EXIT
      . "$0"
    ' "$SCENES/$name.sh"
  rm -rf "$SCENE_TMP"
done
