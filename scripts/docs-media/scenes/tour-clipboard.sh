# The manganese tour's clipboard history, holding text and an image.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/manganese-window-management/src/keyboard/commands.ts
settle 4
copy() { WAYLAND_DISPLAY="$APPS_DISPLAY" wl-copy "$@"; settle 1; }
copy "https://domicile-desktop.com/"
copy --type image/png <"$MEDIA/hero.png"
copy 'domicile load-shell ./dist/shell.js'
"$DOMICILE_BIN" send-shell clipboard
settle 2
shot tour-clipboard
