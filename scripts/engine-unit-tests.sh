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

FILTER='FrameSinkBrokerTest.*:WindowDiffTest.*:EngineEventQueueTest.*:ShortcutRegistryTest.*:ShellURLLoaderFactoryTest.*:ShellDocumentTest.*:ShellSourceTest.*:CursorShapeTest.*:CommandProtocolTest.*:DomicileDisplayListTest.*:DomicileKeyboardLayoutTest.*:ShellWindowsTest.*:ShellWindowPlacesTest.*:LineFramerTest.*:DesktopPrefsTest.*:SurfaceCropTest.*:SurfaceTransformTest.*:SurfaceAlphaTest.*:ExtensionInstallerTest.*:ExtensionTrayEntryTest.*:DeskTabsTest.*:DeskGeometryTest.*:DomicileDisplayRegionsTest.*:DomicileDeskTargeterTest.*:PlaceholderStageTest.*:SystemCallTest.*:PortalRequestTest.*:FileChoiceTest.*:DisplayCaptureTest.*:CapturedFourccTest.*:DisplayCaptureTargetTest.*:HeldChordsTest.*:SitePermissionsTest.*:ControlChannelTest.*:DeviceChoicesTest.*:SurfaceFramesTest.*:GuestDialogsTest.*:DownloadTallyTest.*:SurfaceSubmitsTest.*:PrivatePagesTest.*:ShellOriginTest.*:AppRootsTest.*:AppChannelTest.*:AppDocumentTest.*:WebViewUrlTest.*:ShellFetchTest.*:BrowserWindowCaptureTargetTest.*:ShellWindowWaitTest.*:DeskCursorThemeSourceTest.*:XCursorThemeTest.*:XCursorThemeDirectoryTest.*:SyncedFrameTest.*'

# Every suite in the filter, counted rather than estimated: FrameSinkBroker 41,
# WindowDiff 7, EngineEventQueue 7, ShortcutRegistry 14, ShellURLLoaderFactory
# 12, ShellDocument 14, ShellSource 3, CursorShape 3, CommandProtocol 43,
# DomicileDisplayList 8, DomicileKeyboardLayout 3, ShellWindows 8,
# ShellWindowPlaces 7, LineFramer 4, DesktopPrefs 1, SurfaceCrop 3,
# SurfaceTransform 3, SurfaceAlpha 2, ExtensionInstaller 3, ExtensionTrayEntry 3, DeskTabs 12, DeskGeometry 20,
# DomicileDisplayRegions 27, DomicileDeskTargeter 4, PlaceholderStage 3,
# SystemCall 4, PortalRequest 3, FileChoice 13, DisplayCapture 7,
# CapturedFourcc 1, DisplayCaptureTarget 4, HeldChords 6, SitePermissions 11,
# ControlChannel 10, DeviceChoices 9, SurfaceFrames 6,
# GuestDialogs 6, DownloadTally 6, SurfaceSubmits 4,
# PrivatePages 3, ShellOrigin 2, AppRoots 4, AppChannel 2, AppDocument 3,
# WebViewUrl 5, ShellFetch 22, BrowserWindowCaptureTarget 3, ShellWindowWait 4,
# DeskCursorThemeSource 2, XCursorTheme 5, XCursorThemeDirectory 4,
# SyncedFrame 7.
#
# 406, and it was 405 — the desk an empty layout leaves where the hardware
# put each display is one DeskGeometry case. Before that 405, and it was 403 —
# where a page's popup goes on another monitor is two
# DeskGeometry cases. Before that 403, and it was 402 — the answer a shell
# fetch holds is one ShellFetch case. Before that 402, and it was 399 — a compositor that hangs up being ended for the page
# and replaced is two ControlChannel cases, and the producer said to have gone
# is one FrameSinkBroker case. Before that 399, and it was 395 — the synced frames a move shows with reaching the page
# is one ControlChannel case, and an <app> with no frame set showing the
# newest heard is three SyncedFrame cases. Before that 395, and it was 394 —
# which display each tablet covers is one FrameSinkBroker case. Before that
# 394, and it was 390 — a synced frame's surface id is four SyncedFrame cases.
# Before that 390, and it was 386 — giving back a chord, a page's own claims and a closed
# page's leftovers are three ShortcutRegistry cases, and a window inhibiting
# shortcuts reaching the page is one ControlChannel case. Before that
# 386, and it was 385 — a window's parent and urgency reaching the page is
# one ControlChannel case. Before that 385, and it was 384 — a window's presentation and suspension reaching the page
# is one ControlChannel case. Before that 384, and it was 380 — keeping the desk
# through a blank is four DeskGeometry
# cases. Before that 380, and it was 368 — the desk's pointer theme is the DeskCursorThemeSource,
# XCursorTheme and XCursorThemeDirectory suites and one ControlChannel case.
# Before that 368, and it was 366 — run_app and open_url waiting for the shell window's
# first page is two CommandProtocol cases. Before that 366, and it was 361 —
# waiting for the shell window's first page is four ShellWindowWait cases and
# one CommandProtocol case. Before that 361, and it was 355 — a POST from the shell is six more ShellFetch
# cases. Before that 355, and it was 350 — capturing a browser window alone is three
# BrowserWindowCaptureTarget cases and two FrameSinkBroker ones. Before that
# 350, and it was 348 — each display's connector is two DomicileDisplayList
# cases. Before that 348, and it was 333 — the shell's fetches with the profile's cookies are 15
# ShellFetch cases. Before that 333, and it was 326 — the History app's history and browsing data are
# seven CommandProtocol cases. Before that 326, and it was 323 — listing and
# switching extensions for the Settings app is three CommandProtocol cases.
# Before that 323, and it was 304 — app modules are two ShellURLLoaderFactory cases, three
# CommandProtocol ones, the AppRoots, AppChannel and AppDocument suites, and
# WebViewUrl joining the filter with its two new cases. Before that 304, and it was 303 — a window's owner reaching the page is one more
# ControlChannel case. Before that 303, and it was 301 — only the shell's origin binding the broker is two
# ShellOrigin cases. Before that 301, and it was 300 — counting a <webview>'s finished downloads apart is one
# more DownloadTally case. Before that 300, and it was 301 — Ctrl+wheel zooming again drops the one WheelAction
# case. Before that 301, and it was 300 — a window's size and hints reaching the page is one
# more ControlChannel case. Before that 300, and it was 297 — private browsing ending with its last page is three
# PrivatePages cases. Before that 297, and it was 291 — fencing an shm frame's buffer instead of waiting for
# its copy is two FrameSinkBroker cases and four SurfaceSubmits ones. Before
# that 291, and it was 286 — adding up a <webview>'s downloads for their progress is
# five DownloadTally cases. Before that 286, and it was 280 — the dialog a guest's page has open is six
# GuestDialogs cases. Before that 280, and it was 279 — dropping a waiting embed when its page disconnects is
# one more FrameSinkBroker case. Before that 279, and it was 273 — matching viz's acks and presentation feedback to a
# window's frames is six SurfaceFrames cases. Before that 273, and it was 272 —
# Ctrl+wheel scrolling is one WheelAction case. Before
# that 272, and it was 263 — the ids a <webview>'s device chooser gives the shell
# are nine DeviceChoices cases. Before that 263, and it was 259 — the Settings app's media devices are four
# CommandProtocol cases. Before that 259, and it was 254 — telling a page why its surface ended, so it embeds
# again after a compositor restart, is five more FrameSinkBroker cases. Before
# that 254, and it was 248 — loading and uninstalling extensions from the Settings
# app are six CommandProtocol cases. Before that 248, and it was 246 — a window
# that asks viz for no BeginFrames and answers the ones viz sends anyway is two
# more FrameSinkBroker cases. Before that 246, and it was 241 — turning a
# client's transformed buffer upright is three
# SurfaceTransform cases, and SurfaceAlphaTest was never in the filter, so its
# two cases compiled and ran nowhere. Before that 241, and it was 235 — the Settings app's site permissions are four
# CommandProtocol cases and two SitePermissions ones. Before that 235, and it
# was 232 — a shell crossfading from the one before, and served
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
FLOOR=406

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
