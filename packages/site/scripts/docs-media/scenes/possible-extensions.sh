# The Domicile page's extensions demo, in manganese: a websites list from
# `examples/site-switcher-extension`, an unpacked extension. Three websites on
# three workspaces; its popup, opened from the bar on workspace 1, lists them
# all, and clicking one switches to its workspace.

config "{ \"extensions\": { \"unpacked\": [\"$ROOT/examples/site-switcher-extension\"] } }"
desktop @domicile-desktop/manganese
document
"$DOMICILE_BIN" open https://domicile-desktop.com/
settle 3
"$DOMICILE_BIN" send-shell layout toggle split
"$DOMICILE_BIN" send-shell workspace 2
settle 1
"$DOMICILE_BIN" open "https://en.wikipedia.org/wiki/Wayland_(protocol)"
settle 3
"$DOMICILE_BIN" send-shell workspace 3
settle 1
"$DOMICILE_BIN" open https://github.com/cprussin/domicile
settle 3
"$DOMICILE_BIN" send-shell workspace 1
# Long enough for the extension to load and the pages to finish.
settle 8
record_start possible-extensions
settle 1
caption "The extension's button, in the bar"
# The tray's first button, right of the launcher button.
click 52 16
settle 2.5
shot possible-extensions
caption "Picking Wikipedia switches to workspace 2"
# Its row: keys typed into the popup never reached it.
click 175 188
settle 2.5
record_end
