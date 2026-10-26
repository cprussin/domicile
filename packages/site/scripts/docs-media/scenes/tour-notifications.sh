# The manganese tour's notifications: toasts arriving over a terminal, then the
# drawer opening.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/manganese-notifications/README.md
settle 4
record tour-notifications 9 &
recording=$!
settle 1
notify-send -a foot "Build finished" "cargo build took 4m 12s"
settle 2
notify-send -a Backups "Backup finished" "Your home folder is backed up"
settle 3
"$DOMICILE_BIN" send-shell notifications
wait "$recording"
shot tour-notifications
