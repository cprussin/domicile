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
KEYS_SETTLE=0.2
record_start tour-monitors
settle 0.8
caption "Meta+Shift+2 moves it to the other screen"
"$DOMICILE_BIN" send-shell move container to workspace 2
settle 2.5
shot tour-monitors
record_end
