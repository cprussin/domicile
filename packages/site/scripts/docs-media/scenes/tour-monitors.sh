# The manganese tour's monitors: two side by side, and a window moving from
# one to the other.

config '{
  "output": {
    "displays": [
      { "name": "left", "position": [0, 0], "size": [960, 1200] },
      { "name": "right", "position": [960, 0], "size": [960, 1200] }
    ]
  }
}'
desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/manganese-window-management/docs/WINDOW-MANAGEMENT.md
"$DOMICILE_BIN" open https://domicile-desktop.com/
settle 8
record tour-monitors 8 &
recording=$!
settle 2
# Workspace 2 is the right monitor's. `move right` would only split the two
# windows, since they open tabbed.
"$DOMICILE_BIN" send-shell move container to workspace 2
settle 4
shot tour-monitors
wait "$recording"
