# The Domicile landing page's hero: `hero/shell.js` with nvim on the left, and
# GitHub over btop on the right.

desktop "$SCENE_DIR/shell.js"
app foot -o font="JetBrains Mono:size=12" nvim "$SCENE_DIR/shell.js"
# Only the CPU box: the others list crux's own processes, disks and network.
# A copy, since btop writes its config back.
mkdir -p "$SCENE_TMP/btop-config"
cp -r "$SCENE_DIR/btop" "$SCENE_TMP/btop-config/"
XDG_CONFIG_HOME="$SCENE_TMP/btop-config" app foot -o font="JetBrains Mono:size=12" btop
# Long enough for the web page to load and btop to draw its first graphs.
settle 8
shot hero
record hero 8
