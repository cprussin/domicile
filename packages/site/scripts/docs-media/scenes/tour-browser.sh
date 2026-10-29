# The manganese tour's browser: a document beside a browser window.

desktop @domicile-desktop/manganese
document
"$DOMICILE_BIN" open https://github.com/cprussin/domicile
# Long enough for the wallpaper and the page to load.
settle 8
"$DOMICILE_BIN" send-shell layout toggle split
settle 2
shot tour-browser
