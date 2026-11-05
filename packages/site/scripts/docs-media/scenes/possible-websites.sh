# The Domicile page's websites-as-windows demo, in manganese: a website opened
# from the launcher beside a document, put side by side, then sent to its own
# workspace, followed there and floated. Captions name each key.

desktop @domicile-desktop/manganese
document
# Long enough for the wallpaper and the document.
settle 8
KEYS_SETTLE=0.2

# The launcher once before recording: its first opening loads it, slowly.
"$DOMICILE_BIN" send-shell launcher
settle 2
keys -k Escape
settle 1
record_start possible-websites
settle 0.8
caption "Meta+Space, then a web address"
"$DOMICILE_BIN" send-shell launcher
settle 0.4
keys -d 50 en.wikipedia.org/wiki/Wayland
settle 0.3
keys -k Return
settle 3
caption "Meta+E puts the website beside the document"
"$DOMICILE_BIN" send-shell layout toggle split
settle 2
shot possible-websites
caption "Meta+Shift+2 sends it to workspace 2"
"$DOMICILE_BIN" send-shell move container to workspace 2
settle 1.6
caption "Meta+2 follows it"
"$DOMICILE_BIN" send-shell workspace 2
settle 1.6
caption "Meta+Shift+Tab floats it"
"$DOMICILE_BIN" send-shell floating toggle
settle 2
record_end
