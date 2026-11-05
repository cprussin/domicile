# The Domicile page's CSS demo: SuperTuxKart, Big Buck Bunny and a terminal
# beside Wikipedia, restyled by one CSS rule after another. The shell shows
# each rule at its foot as it applies it.

desktop "$SCENE_DIR/shell.js"
# A grid cell: half the output, less the gaps and the rule strip.
game 945x550
movie
native foot -o font="JetBrains Mono:size=12" \
  "$(nix build --no-link --print-out-paths nixpkgs#asciiquarium)/bin/asciiquarium"
# Long enough for the race to start and the page to load.
settle 12
# Every rule once, from wherever the shell's cycle is.
record possible-css 17.5
shot possible-css
