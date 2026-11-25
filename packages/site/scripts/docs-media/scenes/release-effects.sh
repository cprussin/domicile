# Release notes: the shader effects, in packages/shell-effects-example. The
# cube turns between workspaces, and windows close in smoke, cloth and a
# swarm, picked on the liquid glass bar.

JQ="$(nix build --no-link --print-out-paths nixpkgs#jq)/bin/jq"

# Clicks the bar's button for close effect `$1`, found in the shell page's
# accessibility tree, with the desk's pointer, as a person would.
pick() { # smoke|cloth|swarm
  local node quad
  node="$("$DOMICILE_BIN" devtools shell Accessibility.getFullAXTree '{}' |
    "$JQ" --arg name "$1" -e 'first(.nodes[]
      | select(.role.value == "button" and .name.value == $name)
      | .backendDOMNodeId)')"
  quad="$("$DOMICILE_BIN" devtools shell DOM.getContentQuads "{\"backendNodeId\":$node}" |
    "$JQ" -r -e '.quads[0] | "\((.[0] + .[4]) / 2 | floor),\((.[1] + .[5]) / 2 | floor)"')"
  "$DOMICILE_BIN" pointer "$quad" click
}

# Asks the window whose title matches `$1` to close, as Meta+Shift+Q does.
close_titled() { # title regex
  local id
  id="$("$DOMICILE_BIN" list-windows --json |
    "$JQ" -r --arg title "$1" -e 'first(.[] | select(.title | test($title; "i")) | .id)')"
  "$DOMICILE_BIN" close-window "$id"
}

desktop "$ROOT/packages/shell-effects-example/src/index.ts"
game 1890x1100
"$DOMICILE_BIN" key super+2
settle 2
movie
document
"$DOMICILE_BIN" key super+1
# Long enough for the race to start, the film to play and the effects to
# register.
settle 10
record_start release-effects
settle 1
caption "Meta+2 turns the cube"
"$DOMICILE_BIN" key super+2
settle 2
caption "Meta+Shift+Q closes LibreOffice in smoke"
close_titled "trip"
settle 3
pick cloth
settle 0.6
caption "The bar picks cloth for the film"
close_titled "Big Buck Bunny"
settle 3
caption "Meta+1 turns back"
"$DOMICILE_BIN" key super+1
settle 1.6
pick swarm
settle 0.6
caption "And a swarm for the race"
close_titled "SuperTuxKart"
settle 3.5
record_end
shot release-effects
