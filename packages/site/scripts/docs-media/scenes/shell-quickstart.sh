# The shell quickstart's result: examples/react-shell, run as the quickstart
# says, with its own source beside btop.

desktop "$ROOT/examples/react-shell/shell.tsx"
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim examples/react-shell/shell.tsx
# A copy, since btop writes its config back.
mkdir -p "$SCENE_TMP/btop-config"
cp -r "$ROOT/packages/site/scripts/docs-media/scenes/hero/btop" "$SCENE_TMP/btop-config/"
XDG_CONFIG_HOME="$SCENE_TMP/btop-config" app foot \
  -o font="JetBrains Mono:size=12" btop
# Long enough for btop to draw its first graphs.
settle 6
shot shell-quickstart
