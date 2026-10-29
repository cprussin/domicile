# The manganese tour's tiling clip: Blender, GIMP and a film tabbed, then
# split, then one floated.

desktop @domicile-desktop/manganese
blender_scene
photo
movie
# Long enough for the scene and the photo to draw, and the film to start.
settle 8
KEYS_SETTLE=0.2
record_start tour-tiling
settle 0.8
caption "Meta+E puts them side by side"
"$DOMICILE_BIN" send-shell layout toggle split
settle 1.6
caption "Meta+Shift+Tab floats one"
"$DOMICILE_BIN" send-shell floating toggle
settle 2
record_end
shot tour-tiling
