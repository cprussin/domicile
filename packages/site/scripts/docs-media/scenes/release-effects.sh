# Release notes: the shader effects, in packages/shell-effects-example. The
# cube turns between workspaces, and windows close in smoke, cloth and a
# swarm, picked on the liquid glass bar. Driven with `send-shell`, as the
# manganese scenes are.

JQ="$(nix build --inputs-from "$ROOT" --no-link --print-out-paths 'nixpkgs#jq^bin')/bin/jq"

# Asks the window whose title matches `$1` to close, as Meta+Shift+Q does.
close_titled() { # title regex
  local id
  id="$("$DOMICILE_BIN" list-windows --json |
    "$JQ" -r --arg title "$1" -e 'first(.[] | select(.title | test($title; "i")) | .id)')"
  "$DOMICILE_BIN" close-window "$id"
}

# Waits until the shell hears `send-shell`: the desktop is up before the
# shell's page has bound its commands.
shell_listening() {
  local said
  for _ in $(seq 1 60); do
    if said="$("$DOMICILE_BIN" send-shell workspace 1 2>&1)"; then
      return 0
    fi
    case "$said" in
      *"no page of this desktop listens"*) sleep 0.5 ;;
      *) echo "$said" >&2; exit 1 ;;
    esac
  done
  echo "the example shell never heard send-shell: $said" >&2
  exit 1
}

desktop "$ROOT/packages/shell-effects-example/src/index.ts"
shell_listening
game 1890x1100
"$DOMICILE_BIN" send-shell workspace 2
settle 2
movie
document
"$DOMICILE_BIN" send-shell workspace 1
# Long enough for the race to start, the film to play and the effects to
# register.
settle 10
# The poster: the race, the film and the document, before any closes.
shot release-effects
record_start release-effects
settle 1
caption "Meta+2 turns the cube"
"$DOMICILE_BIN" send-shell workspace 2
settle 2
caption "Meta+Shift+Q closes LibreOffice in smoke"
close_titled "trip"
settle 3
"$DOMICILE_BIN" send-shell close-effect cloth
settle 0.6
caption "The bar picks cloth for the film"
close_titled "Big Buck Bunny"
settle 3
caption "Meta+1 turns back"
"$DOMICILE_BIN" send-shell workspace 1
settle 1.6
"$DOMICILE_BIN" send-shell close-effect swarm
settle 0.6
caption "And a swarm for the race"
close_titled "SuperTuxKart"
settle 3.5
record_end
