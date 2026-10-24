# The manganese tour's screenshot dialog, over a terminal and a browser.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/manganese-window-management/src/keyboard/commands.ts
"$DOMICILE_BIN" open-url https://domicile-desktop.com/
settle 8
"$DOMICILE_BIN" send-shell layout toggle split
settle 1
"$DOMICILE_BIN" send-shell screenshot
settle 2
shot tour-screenshots
