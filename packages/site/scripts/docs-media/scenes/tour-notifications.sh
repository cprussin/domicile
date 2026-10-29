# The manganese tour's notifications: toasts arriving over a game, then the
# drawer opening.

desktop @domicile-desktop/manganese
game
# Long enough for the race to start.
settle 10
record_start tour-notifications
settle 0.6
notify-send -a Blender "Render finished" "All 240 frames are saved"
settle 1.5
notify-send -a Backups "Backup finished" "Your home folder is backed up"
settle 2
caption "The bell opens the ones you missed"
click 1895 16
settle 1.5
record_end
shot tour-notifications
