# The manganese tour's Settings app, beside a terminal.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/app-settings/README.md
"$(dirname "$DOMICILE_BIN")/domicile-settings"
settle 6
"$DOMICILE_BIN" send-shell layout toggle split
settle 2
shot tour-settings
