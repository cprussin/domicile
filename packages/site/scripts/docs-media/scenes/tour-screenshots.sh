# The manganese tour's screenshot dialog, over a film and a browser.

desktop @domicile-desktop/manganese
movie
"$DOMICILE_BIN" open https://domicile-desktop.com/
settle 8
"$DOMICILE_BIN" send-shell layout toggle split
settle 1
"$DOMICILE_BIN" send-shell screenshot
settle 2
shot tour-screenshots
