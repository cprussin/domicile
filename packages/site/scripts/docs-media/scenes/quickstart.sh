# The Domicile page's quickstart: the example shell running nvim beside a
# film, then an edit to its styles and `domicile load-shell`, with the steps in
# captions.

mkdir -p "$SCENE_TMP/my-shell"
cp "$ROOT/examples/react-shell/shell.tsx" "$SCENE_TMP/my-shell/shell.tsx"
desktop "$SCENE_TMP/my-shell/shell.tsx"
# nvim reads the file again when the scene edits it, as it would after a save
# from another editor.
app foot --working-directory="$SCENE_TMP/my-shell" -o font="JetBrains Mono:size=12" \
  nvim -c 'set autoread' \
  -c 'call timer_start(250, {-> execute("checktime")}, {"repeat": -1})' shell.tsx
movie
# Long enough for the film to start.
settle 6

record_start quickstart
settle 1.5
# Only the gap: no window has focus here, so an outline change would not show.
caption "Edit shell.tsx: a wider gap"
sed -i 's/gap: 8, height: "100vh", padding: 8/gap: 32, height: "100vh", padding: 32/' \
  "$SCENE_TMP/my-shell/shell.tsx"
grep -q "gap: 32" "$SCENE_TMP/my-shell/shell.tsx" || {
  echo "examples/react-shell/shell.tsx no longer has the styles this scene edits" >&2
  exit 1
}
settle 2.5
caption "domicile load-shell ./shell.tsx"
"$DOMICILE_BIN" load-shell "$SCENE_TMP/my-shell/shell.tsx"
settle 3
shot quickstart
record_end
