# The manganese page's hero, from an empty desktop, with each key in a
# caption: nvim in a terminal from the launcher, a web page from
# the launcher beside it, then Settings, and a notification.

desktop @domicile-desktop/manganese
# The terminal the launcher opens runs nvim on a shell: keys typed with wtype
# reach a native window through the desktop's keymap, not wtype's, and come
# out garbled.
sed -i "s|^shell=.*|shell=nvim $ROOT/examples/react-shell/shell.tsx|" \
  "$SCENE_TMP/config/foot/foot.ini"
# Long enough for the wallpaper to load.
settle 6
KEYS_SETTLE=0.2

# The launcher once before recording: its first opening loads it, slowly.
"$DOMICILE_BIN" send-shell launcher
settle 2
keys -k Escape
settle 1
record_start manganese-hero
settle 0.8
caption "Meta+Space opens the launcher"
"$DOMICILE_BIN" send-shell launcher
settle 0.4
keys -d 90 foot
settle 0.3
keys -k Return
settle 1.5
caption "Meta+Space, then a web address"
"$DOMICILE_BIN" send-shell launcher
settle 0.4
keys -d 50 domicile-desktop.com
settle 0.3
keys -k Return
settle 2.5
caption "Meta+E puts them side by side"
"$DOMICILE_BIN" send-shell layout toggle split
settle 1.2
caption "Meta+Space, then an app"
"$DOMICILE_BIN" send-shell launcher
settle 0.4
keys -d 90 settings
settle 0.3
keys -k Return
settle 2.5
shot manganese-hero
notify-send -a foot "Build finished" "cargo build took 4m 12s"
settle 2.5
record_end
