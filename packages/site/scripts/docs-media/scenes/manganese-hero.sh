# The manganese page's hero, from an empty desktop: a terminal and a browser
# opened and tiled, the launcher opening Settings beside them, a notification,
# tabs and back, then the notification drawer.

desktop @domicile-desktop/manganese
# Long enough for the wallpaper to load.
settle 6

record manganese-hero 28 &
recording=$!
settle 2
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/shell-manganese/src/Shell.tsx
settle 2
"$DOMICILE_BIN" open https://domicile-desktop.com/
settle 4
# Side by side, not manganese's default tabs.
"$DOMICILE_BIN" send-shell layout toggle split
settle 2
"$DOMICILE_BIN" send-shell launcher
settle 1
keys -d 120 settings
keys -k Return
settle 4
shot manganese-hero
notify-send -a foot "Build finished" "cargo build took 4m 12s"
settle 3
"$DOMICILE_BIN" send-shell layout tabbed
settle 2
"$DOMICILE_BIN" send-shell layout toggle split
settle 2
"$DOMICILE_BIN" send-shell notifications
wait "$recording"
