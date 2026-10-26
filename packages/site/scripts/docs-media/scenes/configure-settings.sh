# The manganese page's "Configure it your way": the Settings app on its Shell
# page, with the clock set to 12-hour in the config.

config '{ "shell_options": { "clock": { "format": "12h" } } }'
desktop @domicile-desktop/manganese
"$(dirname "$DOMICILE_BIN")/domicile-settings"
settle 6
# The sidebar's page buttons come first in the tab order. Shell is the
# eighth.
for _ in $(seq 1 8); do
  keys -k Tab
done
keys -k Return
settle 2
shot configure-settings
