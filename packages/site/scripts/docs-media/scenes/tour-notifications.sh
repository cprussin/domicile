# The manganese tour's notifications: toasts arriving over a terminal, then the
# drawer opening.

desktop @domicile-desktop/manganese
app foot --working-directory="$ROOT" -o font="JetBrains Mono:size=12" \
  nvim packages/manganese-notifications/README.md
settle 4
record_start tour-notifications
settle 0.6
notify-send -a foot "Build finished" "cargo build took 4m 12s"
settle 1.5
notify-send -a Backups "Backup finished" "Your home folder is backed up"
settle 2
caption "The bell opens the ones you missed"
click 1895 16
settle 1.5
record_end
shot tour-notifications
