# The manganese tour's extensions: uBlock Origin Lite's popup, open from its
# button in the tray, over a browser window.

config '{ "extensions": { "web_store": ["ddkjiahejlhfcafbddmgiahcphecmpfh"] } }'
desktop @domicile-desktop/manganese
"$DOMICILE_BIN" open https://domicile-desktop.com/
# Long enough for the Web Store download and the page.
settle 15
# The tray's first button, right of the launcher button.
click 52 16
settle 3
shot tour-extensions
