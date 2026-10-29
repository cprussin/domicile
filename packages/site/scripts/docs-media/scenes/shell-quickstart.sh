# The shell quickstart's result: examples/react-shell, run as the quickstart
# says, with its own source beside a film.

desktop "$ROOT/examples/react-shell/shell.tsx"
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim examples/react-shell/shell.tsx
movie
# Long enough for the film to start.
settle 6
shot shell-quickstart
