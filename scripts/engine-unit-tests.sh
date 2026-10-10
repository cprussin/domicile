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

FILTER='FrameSinkBrokerTest.*:WindowDiffTest.*:EngineEventQueueTest.*:ShortcutRegistryTest.*:ShellURLLoaderFactoryTest.*:ShellDocumentTest.*:ShellSourceTest.*:CursorShapeTest.*:CommandProtocolTest.*:DomicileDisplayListTest.*:DomicileKeyboardLayoutTest.*:ShellWindowsTest.*:ShellWindowPlacesTest.*:LineFramerTest.*:DesktopPrefsTest.*:SurfaceCropTest.*:ExtensionInstallerTest.*:ExtensionTrayEntryTest.*:DeskTabsTest.*:DeskGeometryTest.*:DomicileDisplayRegionsTest.*:DomicileDeskTargeterTest.*:PlaceholderStageTest.*:SystemCallTest.*:PortalRequestTest.*:FileChoiceTest.*:DisplayCaptureTest.*:CapturedFourccTest.*:DisplayCaptureTargetTest.*:HeldChordsTest.*:SitePermissionsTest.*:ControlChannelTest.*'

# Every suite in the filter, counted rather than estimated: FrameSinkBroker 27,
# WindowDiff 7, EngineEventQueue 7, ShortcutRegistry 10, ShellURLLoaderFactory
# 12, ShellDocument 14, ShellSource 3, CursorShape 3, CommandProtocol 11,
# DomicileDisplayList 6, DomicileKeyboardLayout 3, ShellWindows 8,
# ShellWindowPlaces 7, LineFramer 4, DesktopPrefs 1, SurfaceCrop 3,
# ExtensionInstaller 3, ExtensionTrayEntry 3, DeskTabs 12, DeskGeometry 13,
# DomicileDisplayRegions 27, DomicileDeskTargeter 4, PlaceholderStage 3,
# SystemCall 4, PortalRequest 3, FileChoice 13, DisplayCapture 7,
# CapturedFourcc 1, DisplayCaptureTarget 4, HeldChords 6, SitePermissions 9,
# ControlChannel 1.
#
# 235, and it was 232 — a shell crossfading from the one before, and served
# fresh to the navigation that loads it, is two ShellDocument cases and one
# ShellURLLoaderFactory. Before that 232, and it was 230 — refusing a parent frame sink in another renderer is
# two more FrameSinkBroker cases. Before that 230, and it was 229 — the compositor's lines held until the page binds are
# one ControlChannel case. Before that 229, and it was 220 — a <webview>'s permissions are nine SitePermissions
# cases. Before that 220, and it was 223 — the engine takes no screenshots, which was three
# CommandProtocol cases. Before that 223, and it was 215 — pairing a chord's press with its release is six
# HeldChords cases and two more ShortcutRegistry ones. Before that 215, and it was 200 — a display capture is seven DisplayCapture cases, one
# CapturedFourcc, four DisplayCaptureTarget, two more FrameSinkBroker and one
# more EngineEventQueue. Before that 200, and it was 187 — FileChoiceTest was never in the filter, so its
# thirteen cases compiled and ran nowhere. Before that 187, and it was 184 — wrapping a page's answer to a portal request is three
# PortalRequest cases. Before that 184, and it was 183 — the shell document's script policy is one more
# ShellDocument case. Before that 183, and it was 178 — the viewport tiles are sized from and which monitor
# tiles are drawn out of memory is five more DomicileDisplayRegions cases.
# Before that 178, and it was 174 — wrapping a page's system call is four SystemCall
# cases. Before that 174, and it was 171 — when a <webview>'s frame is ready for a guest is three
# PlaceholderStage cases. Before that 171, and it was 168 — a screenshot is three CommandProtocol cases. Before that
# 168, and it was 164 — the tile memory a widget on monitors asks for is four
# more DomicileDisplayRegions cases. Before that 164, and it was 159 — which
# monitors' tilings a layer keeps and draws from, and how many, is five more
# DomicileDisplayRegions cases. Before that 159, and
# it was 155 — which monitor a warp lands on, so the arrow is drawn for it, is
# four DeskGeometry cases. Before that 155, and it was 151 — where a pointer on another monitor lands in the desk's
# page is four DomicileDeskTargeter cases. Before that 151, and it was 137 — every monitor the desk is shown on, at its own
# density, is one DeskGeometry case and thirteen DomicileDisplayRegions ones.
# Before that 137, and it was 144 — one page for the desk has no window a second page
# mirrors, which was seven FrameSinkBroker cases. Before that 144, and it was
# 136 — the one page a desk is, its box, scale, host and screen, is eight
# DeskGeometry cases. Before that 136, and it was 123 — a window a second page
# mirrors is seven more FrameSinkBroker cases, and the tally had that suite at
# 17 when the file held 23. Before that 123, and it was 121 — the factor tabs.setZoom sets and the zoom settings a
# desk tab takes are two more DeskTabs cases. Before that 121, and it was 114 — ShellWindowPlaces was never in the filter, so its five
# cases compiled and ran nowhere; with the two a window still loading its page
# added, that suite is seven. Before that 114, and it was 104 — which <webview> is the active tab, what is refused
# and which tabs a query names is ten DeskTabs cases. Before that 104, and it
# was 101 — how the tray spells a badge color and an icon is three
# ExtensionTrayEntry cases. Before that 101, and it was 98 — which extensions a profile installs, loads and
# uninstalls is three ExtensionInstaller cases. Before that 98, and it was 95 — the part of a client's buffer its window geometry names
# is three SurfaceCrop cases. Before that 95, and it was 94 — the browser's offers turned off is one DesktopPrefs
# case. Before that 94, and it was 90 — how the control channel splits the compositor's socket
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
FLOOR=235

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
