# Release notes: an agent working beside you. Claude opens a page, which gets
# a window of its own beside yours, and searches in it with its own pointer
# and keyboard while you type in yours. Then you take its window over and
# give it back.

agent --remember Claude
desktop @domicile-desktop/manganese
# Your window, its search box waiting for you.
"$DOMICILE_BIN" open https://duckduckgo.com/
settle 8
agent Claude
settle 2
KEYS_SETTLE=0.2
record_start release-agents
settle 1
caption "Claude opens a page in its own window"
"$DOMICILE_BIN" open --agent "$AGENT" https://en.wikipedia.org/wiki/Special:Search
echo "Opened Wikipedia" >&8
settle 4
mine="$("$DOMICILE_BIN" list-windows --json | jq -r 'first(.[] | select(.held_by == null and .kind == "browser") | .id)')"
theirs="$("$DOMICILE_BIN" list-windows --json | jq -r 'first(.[] | select(.held_by != null) | .id)')"
spot="$(page_spot "$mine" combobox)"
read -r ux uy <<<"$spot"
spot="$(page_spot "$theirs" combobox)"
read -r x y <<<"$spot"
caption "Claude uses its own pointer and keys while you type in yours"
click "$ux" "$uy"
agent_glide 1700 1000 "$x" "$y"
"$DOMICILE_BIN" pointer --agent "$AGENT" "$x,$y" click
wtype -d 110 "banana bread recipe" &
typing=$!
for word in Big " " Buck " " Bunny; do
  "$DOMICILE_BIN" type --agent "$AGENT" "$word"
  sleep 0.4
done
"$DOMICILE_BIN" key --agent "$AGENT" Return
echo "Searched for Big Buck Bunny" >&8
wait "$typing"
keys -k Return
settle 3
caption "Click in Claude's window to take it over"
click 1900 640
settle 2.5
spot="$(shell_spot button "Give back to Claude")"
read -r x y <<<"$spot"
caption "Give back lets Claude carry on"
click "$x" "$y"
settle 1
agent_glide 1500 900 1500 700
for _ in 1 2 3; do
  "$DOMICILE_BIN" scroll --agent "$AGENT" 0,240
  sleep 0.4
done
settle 2
record_end
shot release-agents
