# The manganese tour's clipboard history, holding text and an image,
# over GIMP editing the photo it copied.

desktop @domicile-desktop/manganese
photo
settle 4
copy() { WAYLAND_DISPLAY="$APPS_DISPLAY" wl-copy "$@"; settle 1; }
copy "https://domicile-desktop.com/"
ffmpeg -nostdin -loglevel error -i "$PHOTO" -vf scale=1280:-1 "$SCENE_TMP/photo.png"
copy --type image/png <"$SCENE_TMP/photo.png"
copy 'domicile load-shell ./dist/shell.js'
"$DOMICILE_BIN" send-shell clipboard
settle 2
shot tour-clipboard
