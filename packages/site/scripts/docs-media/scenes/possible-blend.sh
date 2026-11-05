# The Domicile page's blended demo: a desktop laid out as an article, with a
# terminal the text wraps around, Wikipedia as a figure, and a film under a
# blended heading. The article scrolls, and the windows with it.

desktop "$SCENE_DIR/shell.js"
native foot -o font="JetBrains Mono:size=12" \
  "$(nix build --no-link --print-out-paths nixpkgs#asciiquarium)/bin/asciiquarium"
movie
# Long enough for the page and the film to start.
settle 10
# One scroll down: the article's animation runs 16 seconds each way.
record possible-blend 16
shot possible-blend
