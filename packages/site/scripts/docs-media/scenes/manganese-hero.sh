# The manganese page's hero: a terminal and a browser tiled side by side, then
# the launcher opening over them and searching.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/shell-manganese/src/Shell.tsx

"$DOMICILE_BIN" open https://domicile-desktop.com/
# Long enough for the wallpaper and the page to load.
settle 8
# Side by side, not manganese's default tabs.
"$DOMICILE_BIN" send-shell layout toggle split
settle 2

shot manganese-hero
# The launcher opens partway through the loop.
record manganese-hero 8 &
recording=$!
settle 3
"$DOMICILE_BIN" send-shell launcher
settle 1
keys -d 120 notes
wait "$recording"
