# The Domicile landing page's live swap: a race and an aquarium side by side,
# then `domicile load-shell` serves a shell that stacks them. Both keep going.
# Not `movie`: mpv's picture stretched to fit each half. Not `blender_scene`:
# its window stayed blank in this shell. Not btop: its graphs start empty.

desktop "$SCENE_DIR/side-by-side.js"
# Half the output, less the gaps.
game 945x1180
# A terminal redraws at any size; asciiquarium fills it at once and lays its
# tank out again when it changes.
native foot -o font="JetBrains Mono:size=12" \
  "$(nix build --no-link --print-out-paths nixpkgs#asciiquarium)/bin/asciiquarium"
# Long enough for the race to start.
settle 12
KEYS_SETTLE=0.2
record_start live-swap
settle 2.5
caption "domicile load-shell ./stacked.js"
"$DOMICILE_BIN" load-shell "$SCENE_DIR/stacked.js"
settle 5
record_end
shot live-swap
