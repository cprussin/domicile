# The Domicile landing page's live swap: a race and a film side by side, then
# `domicile load-shell` serves a shell that stacks them. Both keep playing.

desktop "$SCENE_DIR/side-by-side.js"
# Half the output, less the gaps.
game 945x1180
movie
# Long enough for the race to start and the film to play.
settle 12
KEYS_SETTLE=0.2
record_start live-swap
settle 2.5
caption "domicile load-shell ./stacked.js"
"$DOMICILE_BIN" load-shell "$SCENE_DIR/stacked.js"
settle 5
record_end
shot live-swap
