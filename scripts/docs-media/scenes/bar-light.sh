# Mock-up, not for docs: the manganese desktop in light mode, for the bar.

mkdir -p "$SCENE_TMP/config/domicile"
echo '{"theme":{"mode":"light"}}' >"$SCENE_TMP/config/domicile/domicile.json"
desktop @domicile-desktop/manganese
settle 15
shot bar-light-15s
# Long enough for the 4K wallpaper to load.
settle 30
shot bar-light
grep -aiE "config|theme|output|display|size|error|warn" "$SCENE_TMP/domicile.log" | tail -80 || true
