# Release notes: an agent working beside you. Claude opens a page, which gets
# a window of its own beside yours, and searches in it with its own pointer
# and keyboard while you type in yours. Then you take its window over and
# give it back.

agent --remember Claude
desktop @domicile-desktop/manganese
# Your window, its search box waiting for you.
"$DOMICILE_BIN" open https://duckduckgo.com/
settle 8
# Yours, taken before Claude opens its own: until Claude's pointer or keys are
# in its window, nothing tells the two apart.
mine="$("$DOMICILE_BIN" list-windows --json | jq -r 'first(.[] | select(.kind == "browser") | .id)')"
agent Claude
settle 2
KEYS_SETTLE=0.2
record_start release-agents
settle 1
caption "Claude opens a page in its own window"
"$DOMICILE_BIN" open --agent "$AGENT" https://en.wikipedia.org/wiki/Special:Search
echo "Opened Wikipedia" >&8
settle 4
theirs="$("$DOMICILE_BIN" list-windows --json | jq -r --arg mine "$mine" 'first(.[] | select(.kind == "browser" and .id != $mine) | .id)')"
spot="$(page_spot "$mine" combobox)"
read -r ux uy <<<"$spot"
# Your pointer in your window, so Claude's window is free for its own.
hover "$ux" "$((uy + 300))"
spot="$(page_spot "$theirs" combobox)"
read -r x y <<<"$spot"
caption "Claude uses its own pointer and keys while you type in yours"
click "$ux" "$uy"
agent_glide 1700 1000 "$x" "$y"
"$DOMICILE_BIN" pointer --agent "$AGENT" "$x,$y" click
wtype -d 110 "banana bread recipe" &
typing=$!
# As browser_type types, into the field Claude's click focused.
for word in Big " " Buck " " Bunny; do
  "$DOMICILE_BIN" devtools --agent "$AGENT" "$theirs" Input.insertText \
    "$(jq -cn --arg text "$word" '{text: $text}')" >/dev/null
  sleep 0.4
done
"$DOMICILE_BIN" key --agent "$AGENT" Return
echo "Searched for Big Buck Bunny" >&8
wait "$typing"
keys -k Return
settle 3
caption "Click in Claude's window to take it over"
# Below its search box, in its page.
click "$x" "$((y + 160))"
settle 2.5
for _ in 1 2 3 4 5; do
  spot="$(shell_spot button "Give back to Claude" 2>/dev/null)" && break
  sleep 1
done
spot="${spot:-$(shell_spot button "Give back to Claude")}"
read -r x y <<<"$spot"
caption "Give back lets Claude carry on"
click "$x" "$y"
# Back to your window, which leaves Claude's to Claude: its pointer and keys
# are refused in a window your pointer or keyboard is in.
read -r ox oy <<<"$(page_origin "$mine")"
click "$((ox + 450))" "$((oy - 60))"
settle 1
agent_glide 1500 900 1500 700
for _ in 1 2 3; do
  "$DOMICILE_BIN" scroll --agent "$AGENT" 0,240
  sleep 0.4
done
settle 2
record_end
shot release-agents
