# The Domicile landing page's hero: `hero/shell.js` with SuperTuxKart racing on
# the left, and GitHub over Big Buck Bunny on the right.

desktop "$SCENE_DIR/shell.js"
# The left pane: half the output, less the gaps.
game 945x1180
movie
# Long enough for the race to load and start, and the web page to load.
settle 12
shot hero
record hero 8
