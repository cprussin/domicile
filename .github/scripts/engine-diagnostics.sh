#!/usr/bin/env bash
# Everything a failed engine run wrote down, in the order it is read: from the
# end.
#
# A script rather than an inline `run:` block because GitHub echoes a step's
# script into the log before running it, and a long one buries the failure
# above it under its own source.
set -u

for log in /tmp/domicile-spike-wayland.log \
           /tmp/domicile-client-window-compositor.log \
           /tmp/domicile-two-windows-compositor.log \
           /tmp/domicile-shell-compositor.log \
           /tmp/domicile-shell-bridge.log; do
  [ -f "$log" ] || continue
  echo "::group::$log"
  grep -aE 'app_appeared|brokered a frame sink|configure ->|first frame|engine drew|engine found|has not drawn|agreed the protocol|never released|refused|ERROR|WARN|panic' \
    "$log" | tail -40 || true
  echo "--- last 10 lines:"
  tail -10 "$log" 2>&1 | cut -c1-300 || true
  echo "::endgroup::"
done

# The browser's side, which is where the page's own account of what it embedded
# is. `domicile:` covers both the page's console lines and the embedder's, so
# which element asked for which app and which SurfaceId it got back are in one
# place with the browser's errors.
for log in /tmp/domicile-*-engine.log; do
  [ -f "$log" ] || continue
  echo "::group::$log"
  grep -aE 'domicile:|CONSOLE|Fatal|ERROR:' "$log" | cut -c1-300 | tail -40 || true
  echo "--- last 10 lines:"
  tail -10 "$log" 2>&1 | cut -c1-300 || true
  echo "::endgroup::"
done

echo "the render node:"
ls -l /dev/dri 2>&1 | sed 's/^/  /' || true

# Dead last: a failed job's log is read from the end, and how far down the
# sequence it got is four numbers rather than four hundred lines.
echo "counts, per log:"
for log in /tmp/domicile-*-compositor.log; do
  [ -f "$log" ] || continue
  printf '  %-42s appeared=%s brokered=%s configured=%s drew=%s stuck=%s\n' \
    "$(basename "$log")" \
    "$(grep -ac 'app_appeared' "$log" || true)" \
    "$(grep -ac 'brokered a frame sink' "$log" || true)" \
    "$(grep -ac 'configure ->' "$log" || true)" \
    "$(grep -ac 'engine drew' "$log" || true)" \
    "$(grep -ac 'never released' "$log" || true)"
done

echo "which element embedded which surface:"
grep -ahoE 'domicile: (embedded|embedding|no surface for) .*' /tmp/domicile-*-engine.log 2>/dev/null |
  cut -c1-200 | sort -u | sed 's/^/  /' || true

# A window that maps, is brokered a sink and is configured has still shown
# nothing until it commits a buffer the engine accepts. Two windows and one
# line here is a different failure from two lines and one colour on screen.
echo "whose frames the engine took:"
sed 's/\x1b\[[0-9;]*m//g' /tmp/domicile-*-compositor.log 2>/dev/null |
  grep -a "first frame" | sed 's/.*the engine took/  the engine took/' |
  cut -c1-200 | sort -u || true

echo "what was looked for and found, if anything:"
sed 's/\x1b\[[0-9;]*m//g' /tmp/domicile-*-compositor.log 2>/dev/null |
  grep -aoE 'engine (found|has not drawn) #[0-9A-F]{8}.*' | cut -c1-200 |
  sort -u | sed 's/^/  /' || true

echo "what was drawn, if anything:"
grep -ahoE 'engine drew #[0-9A-F]{8}( at \([0-9]+,[0-9]+\))?' \
  /tmp/domicile-*-compositor.log 2>/dev/null | sort -u | sed 's/^/  /' || true

echo "what was complained about:"
sed 's/\x1b\[[0-9;]*m//g' /tmp/domicile-*-compositor.log 2>/dev/null |
  grep -aoE '(WARN|ERROR) .*' | cut -c1-200 | sort | uniq -c |
  sort -rn | head -20 | sed 's/^/  /' || true
