# The manganese page's hero, from an empty desktop, with each key in a
# caption: Blender from the launcher, a web page from the launcher beside it,
# then Settings, and a notification.

desktop @domicile-desktop/manganese
# Blender as the launcher lists it, and its preferences without the splash
# screen.
ln -sf "$(dirname "$(command -v blender)")/../share/applications/blender.desktop" \
  "$SCENE_TMP/home/.local/share/applications/blender.desktop"
blender_prepare
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
keys -d 90 blender
settle 0.3
keys -k Return
settle 3
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
notify-send -a Blender "Render finished" "All 240 frames are saved"
settle 2.5
record_end
