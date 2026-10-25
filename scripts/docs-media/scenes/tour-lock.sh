# The manganese tour's lock screen.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/manganese-window-management/src/keyboard/commands.ts
# Long enough for the wallpaper to load.
settle 6
"$DOMICILE_BIN" send-shell lock
settle 3
# From the nested sway, since `domicile screenshot` refuses while locked.
grim -o HEADLESS-1 "$MEDIA/tour-lock.png"
echo "wrote docs/media/tour-lock.png"
