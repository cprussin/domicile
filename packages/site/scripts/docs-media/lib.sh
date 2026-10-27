# Helpers for docs media scenes. Sourced by `packages/site/scripts/docs-media.sh` before it
# runs a scene, inside a nested sway on the GPU (`under-wayland.sh`).
#
#   desktop <shell>       start a desktop on a shell, as a user runs one
#   app <command...>      start a Wayland client and wait for its window
#   settle <seconds>      let windows map and draw
#   shot <name>           write docs/media/<name>.png
#   record <name> <secs>  write docs/media/<name>.webm and .mp4
#   record_start <name>   the same, from now until `record_end`
#   caption <text>        name the key about to be pressed, in the recording
#   keys <wtype args...>  type into the desktop
#   click <x> <y>         click the left button at a point on the output
#   config <json>         the desktop's config, before `desktop`
#
# See docs/media/README.md.

# `domicile`, built by `docs-media.sh`.
: "${DOMICILE_BIN:?docs-media.sh builds domicile}"

# Tools the scenes use, fetched once so a scene's timing does not include a
# download.
TOOLS="$(nix build --no-link --print-out-paths \
  nixpkgs#foot nixpkgs#neovim nixpkgs#btop nixpkgs#wtype nixpkgs#wl-clipboard nixpkgs#grim \
  nixpkgs#libnotify nixpkgs#wf-recorder nixpkgs#ffmpeg nixpkgs#jetbrains-mono |
  sed 's#$#/bin#' | paste -sd:)"
export PATH="$TOOLS:$PATH"

# The same fonts on every machine, so captures do not depend on crux's
# fontconfig: Inter for the desktop's text (`sans-serif` and `system-ui`),
# JetBrains Mono for terminals and code, and Noto Color Emoji, which
# Chromium falls back to for emoji.
FONT_DIRS="$(nix build --no-link --print-out-paths nixpkgs#inter nixpkgs#jetbrains-mono \
  nixpkgs#dejavu_fonts nixpkgs#noto-fonts-color-emoji |
  sed 's#.*#  <dir>&/share/fonts</dir>#')"
export FONTCONFIG_FILE="$SCENE_TMP/fonts.conf"
cat >"$FONTCONFIG_FILE" <<FONTS_EOF
<?xml version="1.0"?>
<fontconfig>
$FONT_DIRS
  <cachedir>$SCENE_TMP/fontconfig</cachedir>
  <alias><family>sans-serif</family><prefer><family>Inter</family></prefer></alias>
  <alias><family>system-ui</family><prefer><family>Inter</family></prefer></alias>
  <alias><family>serif</family><prefer><family>DejaVu Serif</family></prefer></alias>
  <alias><family>monospace</family><prefer><family>JetBrains Mono</family></prefer></alias>
</fontconfig>
FONTS_EOF

# A session bus for the desktop, as a login has: `notify-send` reaches the
# desktop's notification server over it. Started by `desktop`.
DBUS="$(nix build --no-link --print-out-paths 'nixpkgs#dbus^out')"

# The display apps join, set by `desktop`.
APPS_DISPLAY=""

# Started processes, stopped by `scene_cleanup`.
STARTED=()

# Starts `domicile` on a shell and waits until the shell joined the
# compositor, so windows started after it are announced to it.
desktop() { # shell module or package
  local log="$SCENE_TMP/domicile.log"
  # A keyboard on the nested sway's seat for the whole scene, as a real
  # session has, started before the engine binds the seat. Without it the seat
  # gains a keyboard with each `keys` and loses it after, so the engine's
  # window can miss its first keys and get a keyboard leave with no enter,
  # which a DCHECK aborts. `-k Shift_L` gives wtype a keymap to upload.
  wtype -k Shift_L -s 86400000 &
  STARTED+=($!)
  sleep 1
  if ! kill -0 "${STARTED[-1]}" 2>/dev/null; then
    echo "no keyboard could be put on the nested sway's seat" >&2
    exit 1
  fi
  # At its own address: the nested sway's bus, and other runs', are elsewhere.
  "$DBUS/bin/dbus-daemon" --config-file="$DBUS/share/dbus-1/session.conf" \
    --address="unix:path=$SCENE_TMP/bus" --nofork --nopidfile \
    >"$SCENE_TMP/bus.log" 2>&1 &
  STARTED+=($!)
  for _ in $(seq 1 40); do
    [ -S "$SCENE_TMP/bus" ] && break
    sleep 0.25
  done
  if [ ! -S "$SCENE_TMP/bus" ]; then
    echo "no session bus came up. dbus-daemon said:" >&2
    cat "$SCENE_TMP/bus.log" >&2
    exit 1
  fi
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$SCENE_TMP/bus"
  # The scene's own config (`config`, else none), whatever crux's user
  # configured. `--no-sandbox` as every guard runs; see
  # packages/domicile-engine/docs/GUARDS.md. `--window-size` the output's, as
  # guard-shell.sh passes: without it manganese's window drew at 945x1180 in
  # the corner of a 1920x1200 output.
  local size="${OUTPUT_MODE%@*}"
  # A made-up home, since the launcher lists the files in it.
  mkdir -p "$SCENE_TMP/home"/{Documents,Downloads,Music,Pictures,Projects/my-shell/src}
  echo "# Notes" >"$SCENE_TMP/home/Documents/notes.md"
  echo "export const Shell = () => {};" >"$SCENE_TMP/home/Projects/my-shell/src/shell.tsx"
  # A terminal the launcher offers, in the scenes' font, for scenes that open
  # one as a user would.
  mkdir -p "$SCENE_TMP/home/.local/share/applications" "$SCENE_TMP/config/foot"
  ln -sf "$(dirname "$(command -v foot)")/../share/applications/foot.desktop" \
    "$SCENE_TMP/home/.local/share/applications/foot.desktop"
  # Plain bash, not the login shell of whoever runs the scenes.
  cat >"$SCENE_TMP/config/foot/foot.ini" <<'FOOT_EOF'
[main]
font=JetBrains Mono:size=12
shell=bash --noprofile --norc
[environment]
PS1=\[\e[36m\]\W\[\e[0m\] \$\040
FOOT_EOF
  HOME="$SCENE_TMP/home" \
  XDG_DATA_HOME="$SCENE_TMP/home/.local/share" \
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

# Fails the scene if the engine has exited since the desktop started.
# `domicile` restarts it, so the capture would otherwise go on with a fresh
# desktop. `scene_cleanup` prints why it exited.
engine_alive() { # step
  local log="$SCENE_TMP/domicile.log"
  if grep -aq "the engine exited" "$log"; then
    echo "the engine exited before $1." >&2
    exit 1
  fi
}

# The desktop at its own resolution, from the compositor.
shot() { # name
  engine_alive "shot $1"
  "$DOMICILE_BIN" screenshot "$MEDIA/$1.png"
  echo "wrote docs/media/$1.png"
}

# The nested sway's output, which the desktop's window fills. A muted loop:
# webm for browsers that play it, mp4 for the rest. From `record_start` to
# `record_end`, or for `record`'s seconds.
#
# Recorded lossless, then compressed at a constant 60 fps by `docs-media.sh`
# once the desktop has stopped: compressing to VP9 while recording kept up
# with 2 to 5 frames a second, and compressing beside a running desktop ran
# the job past its 45 minutes.
record() { # name, seconds
  record_start "$1"
  sleep "$2"
  record_end
}

# The recording going on, its recorder and when it started, for `caption` and
# `record_end`.
RECORDING=""
RECORDER=""
RECORDING_AT=""

record_start() { # name
  local raw="$SCENE_TMP/raw/$1.mkv"
  mkdir -p "$SCENE_TMP/raw"
  rm -f "$raw" "$SCENE_TMP/raw/$1.captions"
  wf-recorder -o HEADLESS-1 -c libx264 -p preset=ultrafast -p crf=0 \
    -f "$raw" >>"$SCENE_TMP/record.log" 2>&1 &
  RECORDER=$!
  RECORDING="$1"
  RECORDING_AT="$(date +%s.%N)"
}

record_end() {
  local raw="$SCENE_TMP/raw/$RECORDING.mkv"
  kill -INT "$RECORDER"
  # wf-recorder writes out the frames it queued before it stops, and can wait
  # for one more frame, which a still desktop never draws. Matroska reads back
  # without its closing index. No `-r 60`: with it wf-recorder wrote no frames
  # at all on crux-light, so `docs-media.sh` makes the rate constant.
  for _ in $(seq 1 120); do
    kill -0 "$RECORDER" 2>/dev/null || break
    sleep 0.5
  done
  if kill -KILL "$RECORDER" 2>/dev/null; then
    echo "wf-recorder had not stopped a minute after $RECORDING ended: killed it" >&2
  fi
  wait "$RECORDER" || true
  engine_alive "the end of record $RECORDING"
  if [ ! -s "$raw" ]; then
    echo "wf-recorder wrote nothing for $RECORDING. It said:" >&2
    tail -20 "$SCENE_TMP/record.log" >&2
    exit 1
  fi
  echo "recorded $RECORDING"
  RECORDING=""
}

# Shows `$1` at the foot of the recording from now, so a watcher sees which
# key did what. Scenes then do it with `send-shell`: Meta chords typed with
# `wtype -M logo` never reached the shell's bindings. `docs-media.sh` draws it; see `captions.sh`.
caption() { # text
  if [ -z "$RECORDING" ]; then
    echo "caption \"$1\" outside a recording" >&2
    exit 1
  fi
  printf '%s\t%s\n' \
    "$(awk -v now="$(date +%s.%N)" -v at="$RECORDING_AT" 'BEGIN { printf "%.2f", now - at }')" \
    "$1" >>"$SCENE_TMP/raw/$RECORDING.captions"
}

# Keys go to the nested sway, which hands them to the desktop's window.
# `KEYS_SETTLE` is the pause after: recorded scenes shorten it and settle
# where they want a pause.
KEYS_SETTLE=1
keys() { # wtype args...
  engine_alive "keys $*"
  wtype "$@"
  sleep "$KEYS_SETTLE"
  engine_alive "the end of keys $*"
}

# Python with pywayland, and the protocols `pointer.py` speaks, for `click`.
POINTER_PYTHON="$(nix build --no-link --print-out-paths --impure --expr \
  '(import (builtins.getFlake "nixpkgs") { }).python3.withPackages (ps: [ ps.pywayland ])')"
# The scanner asks pkg-config for wayland.xml first, and fails outright when
# there is no pkg-config at all; given none, it goes on to the files passed.
POINTER_PKG_CONFIG="$(nix build --no-link --print-out-paths 'nixpkgs#pkg-config^out')"
POINTER_XML=(
  "$(nix build --no-link --print-out-paths 'nixpkgs#wayland-scanner^out')/share/wayland/wayland.xml"
  "$(nix build --no-link --print-out-paths nixpkgs#wlr-protocols)/share/wlr-protocols/unstable/wlr-virtual-pointer-unstable-v1.xml"
)

# Starts `pointer.py`, a virtual pointer that stays on the nested sway's seat
# until the scene ends, on fd 7. Not in `desktop`: with a pointer on the seat
# sway draws a cursor, which recordings would show.
pointer_start() {
  mkdir -p "$SCENE_TMP/pointer/protocols"
  PATH="$POINTER_PKG_CONFIG/bin:$PATH" "$POINTER_PYTHON/bin/pywayland-scanner" -o "$SCENE_TMP/pointer/protocols" \
    -i "${POINTER_XML[@]}" >/dev/null
  touch "$SCENE_TMP/pointer/protocols/__init__.py"
  mkfifo "$SCENE_TMP/pointer.in"
  "$POINTER_PYTHON/bin/python3" -I "$ROOT/packages/site/scripts/docs-media/pointer.py" \
    "$SCENE_TMP/pointer" <"$SCENE_TMP/pointer.in" >"$SCENE_TMP/pointer.out" 2>&1 &
  STARTED+=($!)
  exec 7>"$SCENE_TMP/pointer.in"
  pointer_wait ready
}

# Waits for `pointer.py` to print `$1` as many times as asked so far.
POINTER_DONE=0
pointer_wait() { # word
  local want=1
  if [ "$1" = done ]; then
    POINTER_DONE=$((POINTER_DONE + 1))
    want=$POINTER_DONE
  fi
  for _ in $(seq 1 40); do
    [ "$(grep -cx "$1" "$SCENE_TMP/pointer.out" || true)" -ge "$want" ] && return 0
    sleep 0.25
  done
  echo "the virtual pointer did not answer. It said:" >&2
  cat "$SCENE_TMP/pointer.out" >&2
  exit 1
}

# Clicks the left button at a point on the nested sway's output.
#
# `wlrctl pointer` adds a pointer to the seat and removes it as it exits, so
# the engine's wl_pointer was gone before the click reached it.
click() { # x, y
  engine_alive "click $1 $2"
  [ -p "$SCENE_TMP/pointer.in" ] || pointer_start
  local size="${OUTPUT_MODE%@*}"
  echo "move $1 $2 ${size/x/ }" >&7
  pointer_wait done
  sleep 0.3
  echo click >&7
  pointer_wait done
  sleep 1
  engine_alive "the end of click $1 $2"
}

# The config `desktop` starts on, in place of an empty one.
config() { # json
  mkdir -p "$SCENE_TMP/config/domicile"
  echo "$1" >"$SCENE_TMP/config/domicile/domicile.json"
}

# Stops what the scene started. First prints the engine's fatal lines if it
# exited at any point: a scene can fail on its death at a step that does not
# check for it, and the log's tail is mostly the stack trace.
#
# `|| true`: a stopped process's status is not the scene's, and `set -e` would
# fail a scene that captured everything.
scene_cleanup() {
  if grep -aq "the engine exited" "$SCENE_TMP/domicile.log" 2>/dev/null; then
    echo "the engine exited during the scene. Its fatal lines:" >&2
    grep -aiE "fatal|check failed|received signal|the engine exited" \
      "$SCENE_TMP/domicile.log" | head -20 >&2 || true
  fi
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null || true
    wait "${STARTED[@]}" 2>/dev/null || true
  fi
}
