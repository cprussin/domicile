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
done

# The user-facing build, as `nix run` gets it: the published engine and this
# checkout's compositor. Built once, before any scene writes to docs/media:
# each capture dirties the tree, and building after one rebuilt the shells,
# about four minutes a scene.
DOMICILE_BIN="$(nix build --no-link --print-out-paths "$ROOT#domicile")/bin/domicile"
export DOMICILE_BIN

# The film `movie` plays (lib.sh): Big Buck Bunny, Blender Foundation, CC BY 3.0,
# from the Internet Archive. download.blender.org answers Nix's fetcher with a
# 403.
BIG_BUCK_BUNNY="$(nix eval --impure --raw --expr 'builtins.fetchurl {
  url = "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4";
}')"
echo "Big Buck Bunny: $(nix hash file --type sha256 "$BIG_BUCK_BUNNY")"
export BIG_BUCK_BUNNY

# Compresses the scenes' recordings, below, and draws their captions.
FFMPEG="${FFMPEG:-$(nix build --no-link --print-out-paths 'nixpkgs#ffmpeg^bin')/bin/ffmpeg}"
CAPTION_FONT="$(nix build --no-link --print-out-paths nixpkgs#inter)/share/fonts/truetype/InterVariable.ttf"
# shellcheck source=packages/site/scripts/docs-media/captions.sh
. "$ROOT/packages/site/scripts/docs-media/captions.sh"

for name in "${names[@]}"; do
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
  # Compressed with the desktop stopped, so the encoder has the machine.
  # `-cpu-used 4`: about three times faster than VP9's default effort.
  for raw in "$SCENE_TMP"/raw/*.mkv; do
    [ -e "$raw" ] || continue
    out="$MEDIA/$(basename "$raw" .mkv)"
    filter=(-vf null)
    if [ -s "${raw%.mkv}.captions" ]; then
      filter=(-vf "$(caption_filter "${raw%.mkv}.captions" "$CAPTION_FONT" "$SCENE_TMP/raw")")
    fi
    "$FFMPEG" -nostdin -loglevel error -y -i "$raw" "${filter[@]}" -an -r 60 \
      -c:v libvpx-vp9 -crf 34 -b:v 0 -deadline good -cpu-used 4 -row-mt 1 \
      -tile-columns 2 "$out.webm"
    "$FFMPEG" -nostdin -loglevel error -y -i "$raw" "${filter[@]}" -an -r 60 \
      -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart \
      "$out.mp4"
    echo "wrote docs/media/$(basename "$out").webm and .mp4"
  done
  rm -rf "$SCENE_TMP"
done
