# Mock-up, not for docs: the manganese desktop in light mode, for the bar.

mkdir -p "$SCENE_TMP/config/domicile"
echo '{"theme":{"mode":"light"}}' >"$SCENE_TMP/config/domicile/domicile.json"
desktop @domicile-desktop/manganese
settle 10
SWAY="$(nix build --no-link --print-out-paths nixpkgs#sway nixpkgs#jq | paste -sd' ')"
SWAYMSG="$(echo "$SWAY" | cut -d' ' -f1)/bin/swaymsg"
JQ="$(echo "$SWAY" | cut -d' ' -f2)/bin/jq"
export SWAYSOCK="$(ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock | head -1)"
"$SWAYMSG" -t get_tree -r | "$JQ" -c '.. | objects | select(.type? == "con" or .type? == "floating_con") | {id, name, app_id, layout, rect, focused}' || true
shot bar-light-before
"$SWAYMSG" '[app_id=".*"] floating disable' || true
"$SWAYMSG" 'focus; fullscreen enable' || true
"$SWAYMSG" -t get_tree -r | "$JQ" -c '.. | objects | select(.type? == "con" or .type? == "floating_con") | {id, name, app_id, layout, rect, fullscreen_mode}' || true
# Long enough for the 4K wallpaper to load.
settle 30
shot bar-light
grep -aiE "display|output|theme|wallpaper|photo" "$SCENE_TMP/domicile.log" | grep -v dbus | tail -40 || true
