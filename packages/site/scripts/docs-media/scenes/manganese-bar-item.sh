# The manganese page's customization: examples/manganese-bar-item, manganese
# with the time in Tokyo beside the clock, over a document beside a browser
# window.

desktop "$ROOT/examples/manganese-bar-item/domicile.tsx"
document
"$DOMICILE_BIN" open https://domicile-desktop.com/manganese
# Long enough for the wallpaper and the page to load.
settle 8
"$DOMICILE_BIN" send-shell layout toggle split
settle 3
shot manganese-bar-item
# 16:10, the middle of the top edge: the clock, the new item and the windows
# under them.
ffmpeg -nostdin -loglevel error -y -i "$MEDIA/manganese-bar-item.png" \
  -vf "crop=1060:662:430:0" "$SCENE_TMP/manganese-bar-item.png"
mv "$SCENE_TMP/manganese-bar-item.png" "$MEDIA/manganese-bar-item.png"
