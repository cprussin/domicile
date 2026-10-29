# The manganese tour's web apps: a site opened as an app, beside a document.

desktop @domicile-desktop/manganese
document
"$DOMICILE_BIN" open --app https://excalidraw.com/
# Long enough for the wallpaper and the app to load.
settle 10
"$DOMICILE_BIN" send-shell layout toggle split
settle 2
shot tour-web-apps
