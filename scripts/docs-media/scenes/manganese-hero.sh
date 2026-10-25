# The manganese page's hero: a terminal and a browser tiled side by side, then
# the launcher opening over them.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/shell-manganese/src/Shell.tsx

"$DOMICILE_BIN" open-url https://domicile-desktop.com/
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
# No typing: wtype's keys reach the engine's window without a keyboard
# enter, and the engine's DCHECK aborts it.
settle 2
wait "$recording"
