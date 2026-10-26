# The manganese tour's web apps: a site opened as an app, beside a terminal.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/shell-manganese/src/Shell.tsx
"$DOMICILE_BIN" open --app https://excalidraw.com/
# Long enough for the wallpaper and the app to load.
settle 10
"$DOMICILE_BIN" send-shell layout toggle split
settle 2
shot tour-web-apps
