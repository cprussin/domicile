# The manganese tour's launcher: opened over a terminal and a browser, then
# searched.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/manganese-window-management/src/keyboard/commands.ts
"$DOMICILE_BIN" open https://domicile-desktop.com/
settle 8
"$DOMICILE_BIN" send-shell layout toggle split
settle 1
KEYS_SETTLE=0.2
# The launcher once before recording: its first opening loads it, slowly.
"$DOMICILE_BIN" send-shell launcher
settle 2
keys -k Escape
settle 1
record_start tour-launcher
settle 0.6
caption "Meta+Space opens the launcher"
"$DOMICILE_BIN" send-shell launcher
settle 0.4
keys -d 90 set
settle 2
record_end
shot tour-launcher
