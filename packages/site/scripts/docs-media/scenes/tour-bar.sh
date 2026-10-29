# The manganese tour's bar, up close: the clock and the status icons at the
# right end of the desktop's top edge, over a film beside a browser window.

desktop @domicile-desktop/manganese
movie
settle 2
"$DOMICILE_BIN" open https://domicile-desktop.com/
settle 4
"$DOMICILE_BIN" send-shell layout toggle split
settle 3
shot tour-bar
# 16:10, from just left of the clock to the right edge.
ffmpeg -nostdin -loglevel error -y -i "$MEDIA/tour-bar.png" \
  -vf "crop=1060:662:860:0" "$SCENE_TMP/tour-bar.png"
mv "$SCENE_TMP/tour-bar.png" "$MEDIA/tour-bar.png"
