#!/usr/bin/env bash
# Checks the desk's page ticks at the host display's BeginFrames.
#
# viz gives a frame sink the BeginFrameSource of the first parent that has one.
# After any parent detaches (a compositor recreated, a resume, a hotplug, a new
# renderer), `FrameSinkManagerImpl` reattaches from `registered_sources_`, a
# map keyed by pointer. So a page that is a child of every presenter's
# compositor can end up on a 60 Hz monitor's clock while the host runs at
# 120 Hz, and the whole shell animates at 60.
#
# The host's `DelegatedFrameHost` is the page's only parent. A presenter shows
# the page through its mirrored surface layer, whose frames reference the
# page's surface; viz needs no hierarchy for that. So no fork code makes a
# frame sink a child of a `ui::Compositor`. The broker's hierarchy, a client's
# sink under the page, is fine: the client then ticks at the page's clock.
#
# Reads the series, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
[ -d "$ENGINE/patches" ] || { echo "no patch series at $ENGINE/patches" >&2; exit 1; }
[ -d "$ENGINE/src" ] || { echo "no fork sources at $ENGINE/src" >&2; exit 1; }

CALL='AddChildFrameSink\('
found="$(
  grep -rnE "$CALL" "$ENGINE/src"
  grep -nE "^\+.*$CALL" "$ENGINE"/patches/*.patch
)"
if [ -n "$found" ]; then
  echo '  FAIL  the desk page ticks at the host display'
  echo '    fork code makes a frame sink a child of another compositor:'
  printf '%s\n' "$found" | sed "s|^$ROOT/|      |"
  echo "1 failed"
  exit 1
fi
echo '  ok    the desk page ticks at the host display'

echo "all ok"
