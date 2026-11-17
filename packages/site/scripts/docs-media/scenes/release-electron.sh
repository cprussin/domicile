# Release notes: Element, an Electron app, on the desktop's engine, with its
# menu bar under its tab.

ELEMENT="$(nix build --no-link --print-out-paths nixpkgs#element-desktop)"
# A fresh Element asks where to keep its keys before any page; this answers it.
mkdir -p "$SCENE_TMP/config/Element"
echo '{"safeStorageBackend":"basic_text"}' >"$SCENE_TMP/config/Element/electron-config.json"
desktop @domicile-desktop/manganese
# In the desktop's made-up home, where the answer above is. It runs until
# Element quits, so it runs beside the scene.
HOME="$SCENE_TMP/home" XDG_CONFIG_HOME="$SCENE_TMP/config" \
  "$DOMICILE_BIN" open --electron "$ELEMENT/bin/element-desktop" \
  >>"$SCENE_TMP/apps.log" 2>&1 &
STARTED+=($!)
settle 20
shot release-electron-closed
keys -k Alt_L
settle 2
shot release-electron
