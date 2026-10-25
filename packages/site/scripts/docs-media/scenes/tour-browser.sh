# The manganese tour's browser: a terminal beside a browser window.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/shell-manganese/src/Shell.tsx
"$DOMICILE_BIN" open https://github.com/cprussin/domicile
# Long enough for the wallpaper and the page to load.
settle 8
"$DOMICILE_BIN" send-shell layout toggle split
settle 2
shot tour-browser
