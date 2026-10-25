# The manganese tour's launcher: opened over a terminal and a browser, then
# searched.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/manganese-window-management/src/keyboard/commands.ts
"$DOMICILE_BIN" open-url https://domicile-desktop.com/
settle 8
"$DOMICILE_BIN" send-shell layout toggle split
settle 1
record tour-launcher 7 &
recording=$!
settle 1
"$DOMICILE_BIN" send-shell launcher
settle 1
keys -d 150 set
wait "$recording"
shot tour-launcher
