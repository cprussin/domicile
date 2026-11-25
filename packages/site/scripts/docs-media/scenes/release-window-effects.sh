# Release notes: manganese's window effects and springs. A workspace switch
# blurs the windows it slides, the overview throws the wallpaper out of
# focus, a theme change wipes in, and a closed window dissolves.

desktop @domicile-desktop/manganese
document
"$DOMICILE_BIN" send-shell workspace 2
game 940x1150
movie
"$DOMICILE_BIN" send-shell workspace 1
# Long enough for the race to start and the film to play.
settle 10
KEYS_SETTLE=0.2
record_start release-window-effects
settle 1
caption "Meta+2 slides to workspace 2"
"$DOMICILE_BIN" send-shell workspace 2
settle 1.8
caption "Meta+O opens the overview"
"$DOMICILE_BIN" send-shell overview
settle 2.2
caption "Meta+O closes it"
"$DOMICILE_BIN" send-shell overview
settle 1.6
caption "A theme change wipes in"
"$DOMICILE_BIN" theme toggle
settle 2.2
caption "Meta+Shift+Q closes a window"
"$DOMICILE_BIN" send-shell kill
settle 2.5
record_end
shot release-window-effects
