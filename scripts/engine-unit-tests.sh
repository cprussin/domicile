#!/usr/bin/env bash
# The fork's own gtest cases, in domicile_unittests.
#
# The cheapest thing that can fail and the only thing that exercises the
# broker's bookkeeping directly — a surface brokered per app, an embed held for
# the app it names — so this runs before the guards, which take longer and say
# less about why.
#
# AND COUNTED BEFORE IT IS RUN, because `--gtest_filter` matching nothing exits
# 0. A suite that was renamed or never linked is otherwise a silent pass, which
# is what happened: `ShellURLLoaderFactoryTest` and `ShellDocumentTest` were in
# the build and not in this list, so they compiled on every run and executed on
# none. Between them they are what refuses a path traversal out of the shell
# root and what pins the one document every desktop is.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

FILTER='FrameSinkBrokerTest.*:WindowDiffTest.*:EngineEventQueueTest.*:ShortcutRegistryTest.*:ShellURLLoaderFactoryTest.*:ShellDocumentTest.*:ShellSourceTest.*:CursorShapeTest.*:CommandProtocolTest.*:DomicileDisplayListTest.*:DomicileKeyboardLayoutTest.*:ShellWindowsTest.*:LineFramerTest.*'

# Every suite in the filter, counted rather than estimated: FrameSinkBroker 17,
# WindowDiff 7, EngineEventQueue 6, ShortcutRegistry 7, ShellURLLoaderFactory
# 11, ShellDocument 11, ShellSource 3, CursorShape 3, CommandProtocol 8,
# DomicileDisplayList 6, DomicileKeyboardLayout 3, ShellWindows 8,
# LineFramer 4.
#
# 94, and it was 90 — how the control channel splits the compositor's socket
# into lines is four LineFramer cases. Before that 90, and it was 82 — which displays want a shell window is eight ShellWindows
# cases, a suite of its own and so in the filter as well as in the sum. Before
# that it was 79 — the layout a producer states back is three more
# FrameSinkBroker cases. Before that 77 — the name a display list now carries,
# which is what an output profile matches a monitor on, is two more
# DomicileDisplayList cases. Before that 74 — the keymap the compositor sends
# is three DomicileKeyboardLayout cases. Before that 70, which the panel a
# display list now carries moved, and 66 before that, which the display list
# itself did, and 46 before THAT, which was not drift: WindowDiffTest and
# EngineEventQueueTest had always been in the filter and were never in the sum,
# so the floor sat 12 below the truth and a whole suite could have stopped
# linking with room to spare. That is the failure this exists to catch, so the
# number is the real one.
FLOOR=94

# From inside the out directory, because this is a component build and the
# binary loads its own .so files from beside it.
cd "$ENGINE_OUT"

# Test names are the indented lines of --gtest_list_tests; suite names are not.
count=$(./domicile_unittests --gtest_filter="$FILTER" --gtest_list_tests |
  grep -cE '^  ' || true)
echo "$count tests match the fork's filter (floor $FLOOR)"
[ "$count" -ge "$FLOOR" ] || {
  annotate "only $count tests matched; the suites were renamed or did not link"
  exit 1
}

./domicile_unittests --gtest_filter="$FILTER"
