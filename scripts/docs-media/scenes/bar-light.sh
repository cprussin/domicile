# Mock-up, not for docs: the manganese desktop in light mode, for the bar.

mkdir -p "$SCENE_TMP/config/domicile"
echo '{"theme":{"mode":"light"}}' >"$SCENE_TMP/config/domicile/domicile.json"
desktop @domicile-desktop/manganese
settle 5
TOOLS2="$(nix build --no-link --print-out-paths nixpkgs#sway nixpkgs#grim | paste -sd' ')"
SWAYMSG="$(echo "$TOOLS2" | cut -d' ' -f1)/bin/swaymsg"
GRIM="$(echo "$TOOLS2" | cut -d' ' -f2)/bin/grim"
export SWAYSOCK="$(ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock | head -1)"
# Nudge a resize so the desktop re-reads its window size.
"$SWAYMSG" 'fullscreen enable' || true
settle 3
"$SWAYMSG" 'fullscreen disable' || true
# Long enough for the 4K wallpaper to load.
settle 30
"$GRIM" -o HEADLESS-1 "$MEDIA/bar-light-grim.png" || true
shot bar-light
grep -aE "advertising output|displays" "$SCENE_TMP/domicile.log" | tail -10 || true
