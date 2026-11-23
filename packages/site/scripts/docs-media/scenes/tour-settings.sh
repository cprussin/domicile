# The manganese tour's Settings app, beside GIMP.

desktop @domicile-desktop/manganese
"$DOMICILE_BIN" set-log-level trace rendering >&2
photo
"$(dirname "$DOMICILE_BIN")/domicile-settings"
settle 6
"$DOMICILE_BIN" send-shell layout toggle split
settle 2
shot tour-settings
