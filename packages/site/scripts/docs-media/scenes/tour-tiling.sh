# The manganese tour's tiling clip: three terminals tabbed, then split, then
# one floated.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/manganese-window-management/src/keyboard/commands.ts
# Only the CPU box, as in the hero: the others list crux's own processes.
mkdir -p "$SCENE_TMP/btop-config"
cp -r "$ROOT/packages/site/scripts/docs-media/scenes/hero/btop" "$SCENE_TMP/btop-config/"
XDG_CONFIG_HOME="$SCENE_TMP/btop-config" app foot \
  -o font="JetBrains Mono:size=12" btop
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  sh -c 'ls --color=always packages; exec sh'
settle 5
record tour-tiling 10 &
recording=$!
settle 2
"$DOMICILE_BIN" send-shell layout toggle split
settle 4
"$DOMICILE_BIN" send-shell floating toggle
wait "$recording"
shot tour-tiling
