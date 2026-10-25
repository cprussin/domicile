# Helpers for docs media scenes. Sourced by `scripts/docs-media.sh` before it
# runs a scene, inside a nested sway on the GPU (`under-wayland.sh`).
#
#   desktop <shell>       start a desktop on a shell, as a user runs one
#   app <command...>      start a Wayland client and wait for its window
#   settle <seconds>      let windows map and draw
#   shot <name>           write docs/media/<name>.png
#   record <name> <secs>  write docs/media/<name>.webm and .mp4
#   keys <wtype args...>  type into the desktop
#
# See docs/media/README.md.

# The user-facing builds, as `nix run` gets them: the published engine and
# this checkout's compositor.
DOMICILE_BIN="$(nix build --no-link --print-out-paths "$ROOT#domicile")/bin/domicile"

# Tools the scenes use, fetched once so a scene's timing does not include a
# download.
TOOLS="$(nix build --no-link --print-out-paths \
  nixpkgs#foot nixpkgs#neovim nixpkgs#btop nixpkgs#wtype \
  nixpkgs#wf-recorder nixpkgs#ffmpeg nixpkgs#jetbrains-mono |
  sed 's#$#/bin#' | paste -sd:)"
export PATH="$TOOLS:$PATH"

# One font for every terminal, so captures do not depend on the machine's
# fontconfig.
FONTS="$(nix build --no-link --print-out-paths nixpkgs#jetbrains-mono)"
export FONTCONFIG_FILE="$SCENE_TMP/fonts.conf"
cat >"$FONTCONFIG_FILE" <<FONTS_EOF
<?xml version="1.0"?>
<fontconfig>
  <dir>$FONTS/share/fonts</dir>
  <cachedir>$SCENE_TMP/fontconfig</cachedir>
</fontconfig>
FONTS_EOF

# The display apps join, set by `desktop`.
APPS_DISPLAY=""

# Started processes, stopped by `scene_cleanup`.
STARTED=()

# Starts `domicile` on a shell and waits until the shell joined the
# compositor, so windows started after it are announced to it.
desktop() { # shell module or package
  local log="$SCENE_TMP/domicile.log"
  # An empty config, so the desktop runs on defaults whatever crux's user
  # configured. `--no-sandbox` as every guard runs; see
  # packages/domicile-engine/docs/GUARDS.md. `--window-size` the output's, as
  # guard-shell.sh passes: without it manganese's window drew at 945x1180 in
  # the corner of a 1920x1200 output.
  local size="${OUTPUT_MODE%@*}"
  # A made-up home, since the launcher lists the files in it.
  mkdir -p "$SCENE_TMP/home"/{Documents,Downloads,Music,Pictures,Projects/my-shell/src}
  echo "# Notes" >"$SCENE_TMP/home/Documents/notes.md"
  echo "export const Shell = () => {};" >"$SCENE_TMP/home/Projects/my-shell/src/shell.tsx"
  HOME="$SCENE_TMP/home" \
  XDG_CONFIG_HOME="$SCENE_TMP/config" \
  XDG_STATE_HOME="$SCENE_TMP/state" \
  DOMICILE_ENGINE_ARGS="--no-sandbox --disable-component-update --window-size=${size/x/,}" \
  RUST_LOG="info,domicile_compositor=debug" \
    "$DOMICILE_BIN" "$1" >"$log" 2>&1 &
  STARTED+=($!)
  # `domicile <verb>` finds the desktop by this, as an app inside it would.
  export DOMICILE_SOCK="$XDG_RUNTIME_DIR/domicile-ipc.$!.sock"

  for _ in $(seq 1 240); do
    # `|| true`: no match yet is not an error, and `set -e` would end the
    # scene.
    APPS_DISPLAY="$(grep -a "apps connect here" "$log" | grep -aoE "wayland-[0-9]+" | head -1 || true)"
    [ -n "$APPS_DISPLAY" ] && grep -aq "chrome agreed the protocol" "$log" && return 0
    kill -0 "${STARTED[-1]}" 2>/dev/null || break
    sleep 0.5
  done
  echo "the desktop never came up. domicile said:" >&2
  tail -40 "$log" >&2
  exit 1
}

# Starts a client on the desktop and waits for its window, so a scene's
# windows arrive, and are laid out, in the order it starts them.
app() { # command...
  local log="$SCENE_TMP/domicile.log"
  local before
  before="$(grep -ac "app_appeared" "$log" || true)"
  WAYLAND_DISPLAY="$APPS_DISPLAY" "$@" >>"$SCENE_TMP/apps.log" 2>&1 &
  STARTED+=($!)
  for _ in $(seq 1 60); do
    [ "$(grep -ac "app_appeared" "$log" || true)" -gt "$before" ] && return 0
    sleep 0.5
  done
  echo "no window from $1. It said:" >&2
  tail -20 "$SCENE_TMP/apps.log" >&2
  exit 1
}

settle() { # seconds
  sleep "$1"
}

# The desktop at its own resolution, from the compositor.
shot() { # name
  "$DOMICILE_BIN" screenshot "$MEDIA/$1.png"
  echo "wrote docs/media/$1.png"
}

# The nested sway's output, which the desktop's window fills. A muted loop:
# webm for browsers that play it, mp4 for the rest.
record() { # name, seconds
  local webm="$MEDIA/$1.webm"
  rm -f "$webm"
  wf-recorder -o HEADLESS-1 -c libvpx-vp9 -p crf=40 -p b=0 -f "$webm" \
    >>"$SCENE_TMP/record.log" 2>&1 &
  local recorder=$!
  sleep "$2"
  kill -INT "$recorder"
  wait "$recorder" || true
  ffmpeg -loglevel error -y -i "$webm" -an -c:v libx264 -pix_fmt yuv420p \
    -crf 28 -movflags +faststart "$MEDIA/$1.mp4"
  echo "wrote docs/media/$1.webm and docs/media/$1.mp4"
}

# Keys go to the nested sway, which hands them to the desktop's window.
keys() { # wtype args...
  wtype "$@"
}

# `|| true`: a stopped process's status is not the scene's, and `set -e` would
# fail a scene that captured everything.
scene_cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null || true
    wait "${STARTED[@]}" 2>/dev/null || true
  fi
}
