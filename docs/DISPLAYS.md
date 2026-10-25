# Displays on a tty

How the compositor arranges the monitors the engine scans out on. Overview:
[A-DESKTOP-ON-A-TTY.md](architecture/A-DESKTOP-ON-A-TTY.md#outputs).

## Where the display list comes from

| Source | Constructor | Decided by |
|---|---|---|
| `output.displays` | `Screens::described` | the config |
| `output.profiles` | `Screens::from_the_layout` | the config, matched against what DRM reports |
| the engine's reading | `Screens::from_the_engine` | the hardware, when no profile matches |
| Domicile's own window | `Screens::following_the_window` | the host, on a nested run |

- `Screens::replugged_into` picks the source on a hotplug. `output.displays`
  always wins over DRM.
- A hotplug rearranges outputs instead of recreating them.
  `Screens::rearranged_into` matches by `wl_output` name, so clients stay on
  their output.
- An engine reading whose displays overlap is skipped when no profile matches
  and none was in force. `DrmScreen` updates its display list one display at a
  time and the engine reports after each step, so mid-update lists can stack a
  new monitor on another. The last report of each update is laid out.
- A config reload re-matches profiles against the last engine reading
  (`engine_displays`, `Screens::reloaded_into`). This lets a profile take effect
  as soon as it is saved.

## Profiles

A profile names the displays it is for. The first profile whose displays are
all plugged in wins. This is kanshi's model.

```json
{
  "output": {
    "profiles": [
      {
        "name": "home-office-full",
        "displays": [
          { "display": "drm-1", "enabled": false },
          { "display": "drm-2", "position": [0, 0], "scale": 1.2, "transform": "rotate-270" },
          { "display": "drm-3", "position": [1800, 0], "scale": 1.2, "transform": "rotate-270" }
        ]
      }
    ]
  }
}
```

- Matching and placement are in `domicile-config`'s `profile.rs`.
- An entry without `position` goes in a row right of the positioned entries,
  in profile order, level with their top. With none positioned the row starts
  at the origin. The row uses each display's logical size and is recomputed
  with every layout, so it follows mode changes. This matches how the engine
  places unnamed connectors (`OriginsForLayout`).
- `scale` is fractional. `wl_output` sends it rounded up, and `xdg_output`
  reports the real logical size.
- `mode = [W, H]` asserts the monitor's mode. Positions add up mode sizes, so a
  different mode would shift every display after it. `Layout::of` rejects a
  mismatch with `ConfigError::Validation`, and a reload keeps the running
  desktop.
- A profile cannot request a mode. Each connector scans out its own
  `native_mode()`. Supporting this needs a field on `DomicileDisplayLayout` and
  a mode lookup in `drm_modeset.cc`.
- `mode` has no refresh rate. A rate changes no layout math, cannot be chosen,
  and some monitors report none.

## Which connectors light

`Layout::scanout` tells the engine which connectors to light and where. The
config lives in the compositor and DRM master in the browser, so it crosses:

```
Layout::scanout  →  Screens::scanout  →  domicile_displays_configure
  → FrameSinkBroker.ConfigureDisplays  →  OzonePlatform::SetDomicileDisplayLayout
  → DrmModeset::SetLayout              →  ModesetParamsFromSnapshots
```

Rules:

- **Empty layout:** the hardware decides. Every connector lights, in one row in
  connector order. This also undoes a profile that turned a panel off. The
  desk spans the row, each display at its CRTC rectangle and scale 1, as
  `Screens::from_the_engine` advertises it.
- **Blank:** every connector listed with `enabled: false`. The desk stays as it
  was ([IDLE.md](IDLE.md)).
- **A connector turned off is modeset with no mode**, which turns its CRTC off.
  Left out of the modeset, it would keep scanning out its last frame.
- **Non-empty layout:** a connector the layout does not name is turned off. This
  happens only to a monitor plugged in after the compositor built the layout.
  The next layout lights it.
- **Every connector gets its own origin.** Unnamed connectors go past the right
  edge of the named ones, in connector order (`OriginsForLayout`). ozone gives
  a new connector `(0, 0)`, which would stack monitors on one rectangle.
- **Primary is the first lit display.** The browser's first window goes to the
  primary display, so a dark primary means a black desktop.
- **Connectors follow the profile's placement order**, not connector numbers.
- **Each connector takes its mode size** on the engine's desktop, not its
  logical size.
- **All connectors sit in one row.** Nothing draws across connectors, so the
  row is invisible to the user.

## Pointer crossing

Patches `0050` and `0052` move the pointer between monitors in
`DrmCursor::MoveCursor`. Upstream clamps it to the current window. The math is
`ui/ozone/platform/drm/domicile/drm_pointer_crossing.h`, with tests.

- The layout carries each lit display's rectangle on the shell's desktop
  (`desk`). The pointer leaves by any edge and lands at the same desktop
  position, as in sway.
- A dark connector is never entered. With no layout, the engine's own desktop
  is used.
- A gap of up to one logical pixel counts as touching, because profile
  positions round outward.
- Edges are read in the monitor's rotated frame, using `CursorController`'s
  rotation.
- All pointer and key events go to the desk's host window
  (`OzonePlatform::SetDomicileDeskHost`, `PointerInWindow`).

## Tablets and touchscreens

`input.pointers` binds each tablet, touchscreen or absolute mouse to one
display. Config: [SHELL-CONFIG.md](SHELL-CONFIG.md#tablets-and-touchscreens).

- **Absolute mouse:** absolute X and Y, `BTN_LEFT` and `BTN_RIGHT`, and no
  `BTN_TOUCH`, pen or input property (`EventDeviceInfo::HasAbsoluteMouse`,
  patch `0123`). QEMU's USB tablet is one, and QEMU gives each head its own.
- **Touchscreen:** any other device with absolute X and Y and no pen
  (`EventDeviceInfo::HasTouchscreen`), including one that clicks with
  `BTN_LEFT` alone.
- The compositor resolves each entry's `display` against the engine's last
  display report (`pointer_targets`) and sends device-to-display-id targets
  on every report and reload:

```
bind_the_pointers  →  domicile_pointers_configure  →  FrameSinkBroker.ConfigurePointers
  → OzonePlatform::SetDomicilePointerTargets  →  DrmPointerTargets
  → DeviceDataManager::ConfigureTouchDevices     (touchscreens)
  → DrmCursor::SetDomicileAbsoluteAreas          (absolute mice)
```

- `ui/ozone/platform/drm/domicile/drm_pointer_targets.h` has the mapping,
  with tests. A touchscreen or mouse hotplug reapplies the targets.
- A display's CRTC rectangle, unrotated, is what a device's range covers.

### Absolute mice

`AbsoluteMouseEventConverterEvdev` (`ui/events/ozone/evdev/domicile/`, with
tests) reads one as a mouse:

- A position moves the pointer onto the bound display, crossing windows. A
  move with no button held hovers.
- Every mouse button is a mouse button, remappable like any mouse's.
- The wheels scroll in 120ths of a notch, from `REL_WHEEL_HI_RES` and
  `REL_HWHEEL_HI_RES` where the device sends them.
- An unbound one covers the display the pointer is on, as a pen tablet does.

### Touchscreens

- Upstream sends a touch only to the window of the display
  `DeviceDataManager` binds its device to. Only ash binds one, so an unbound
  device's touches are dropped.
- `TouchTransformsFor` gives each bound touchscreen a transform onto its
  display.
- `DrmWindowHost` sends a bound touch to the desk's host, placed with
  `PointerInWindow` as the pointer is (patch `0122`).
- Touches move no pointer. A touchscreen's button down and up are a tap.

## Rotation

The modeset cannot rotate: `DisplayConfigurationParams` has no rotation field.
Rotation happens in the render tree, as on ChromeOS. Each monitor has its own
window so each can rotate and scale on its own.

| Piece | Role |
|---|---|
| `DomicileDisplayLayout` | Carries the profile's `transform` and `scale` |
| `DrmScreen` | Sets `rotation` and `device_scale_factor` on `display::Display`; `bounds` stay in CRTC pixels |
| `DesktopWindowTreeHostPlatform` (patch `0043`) | With `turns_windows_with_their_display` (DRM only), applies a root transform and passes a display transform hint, so viz rotates the frame on output. Screen rectangles stay in pixels (patch `0045`) |
| `CursorController` | Built off ChromeOS so `DrmCursor::MoveCursor` rotates pointer motion. `DrmWindowHost` updates it |
| `wm::CursorLoader` | Rotates and scales the cursor image, the desk's theme (patch `0125`) as well as Chromium's art |

- A window is the monitor's logical box, upright. A 4K panel rotated at scale
  1.2 is a window of 1800×3200 DIPs.
- Each `<app>` element passes its scale (patch `0044`, `configure_at`) so the
  compositor can convert the box from the page's device pixels to the logical
  pixels a configure uses.
- `rotate-270` turns content a quarter clockwise, for a panel on its left side.
  This matches `wl_output` and kanshi. `RotationOf` in `drm_screen.cc` converts.
- A rotated monitor's capture is upright. viz captures the window's frame
  before it turns it for the panel, so screenshots and monitor and region
  casts read it as they read any other monitor.
- A client that pre-rotates its buffer for a rotated panel
  (`wl_surface.set_buffer_transform`) is shown and cast upright. See
  [WINDOW-COMPOSITING.md](architecture/WINDOW-COMPOSITING.md#pre-rotated-buffers).

## Shell windows

Each display gets its own browser window, and one shell page spans them all:
[ONE-PAGE-FOR-THE-DESK.md](architecture/ONE-PAGE-FOR-THE-DESK.md). On a
hotplug, `ShellWindows` opens new windows before closing old ones and never
closes the last window, since that would exit the browser. A new host's window
is created asynchronously, so `ShellWindows` reconciles again once it exists
to watch its page.

## Monitor names

A monitor's `wl_output` name is:

- `drm-<id>` when its EDID gives a make, model or serial;
- its connector otherwise, as the kernel and sway name it: `DP-1`,
  `HDMI-A-1`, `eDP-1`.

A profile's `display` matches any of:

- the `wl_output` name;
- the description, `"<MAKE> <MODEL> <SERIAL>"`, as kanshi and sway use;
- the description with the maker's full name.

Example: `Dell Inc. DELL U3219Q 2ZLS413`, `DEL DELL U3219Q 2ZLS413` or
`drm-<id>`. Without hwdata's PNP table, the description uses the three-letter
code and the compositor logs one line at startup.

- The label travels as `display::Display::label` → the mojom `Display` →
  `const char*` on `DomicileDisplay`.
- The GPU process names the connector
  (`ui/ozone/platform/drm/domicile/connector_name.cc`). It travels as
  `display::DisplaySnapshot::domicile_connector` → `DrmScreen::connectors()`
  → `OzonePlatform::GetDomicileConnectors` → the mojom `Display` →
  `DomicileConnectedDisplay::connector`. `display::Display` has no field for
  it.
- `ui/ozone/platform/drm/domicile/edid_name.cc` reads the serial from the EDID.
  `display::EdidParser` keeps only a hash, and the serial is what tells
  identical monitors apart. The file uses no Chromium types, so it is tested
  outside a Chromium tree.
- `packages/domicile-compositor/src/pnp_ids.rs` expands the maker code from
  hwdata's `pnp.ids`, read at startup from `DOMICILE_PNP_IDS` (set by the
  flake's wrapper) or the distribution's path. It is read at run time because
  the table is GPL-2+ and this repo is MIT OR Apache-2.0.
- An engine without `connected_displays` reports no connector, so the
  compositor names every monitor `drm-<id>`.

## Physical size and refresh

- The browser process, and so the compositor, learns about a display only
  through `display::Display`.
- `display::Display` has a refresh rate but no physical size. `DrmScreen`
  stores the millimeters as `pixels_per_inch`, and
  `components/domicile/browser/display_list.cc` converts back with
  `display::kInchInMm`.
- `DomicileDisplay` carries both fields. Zero means unknown, as in
  `wl_output`.
- `DisplayList::UpdateDisplay` does not copy either field. This is safe: the
  display id comes from the EDID, so the same id is the same panel, with the
  same size and native mode.

## Night light

The shell sets a color temperature; the compositor scales every monitor's
gamma ramp to that white.

```
set_color_temperature {kelvin}  →  domicile_host::white_point  →  domicile_displays_set_white_point
  → FrameSinkBroker.SetWhitePoint  →  OzonePlatform::SetDomicileWhitePoint  →  DrmModeset::SetWhitePoint
  → NativeDisplayDelegate::SetGammaAdjustment
```

- `kelvin` is 1000 to 6500. 6500 is neutral and clears the ramp.
- A gamma ramp, not a color matrix, so it works on drivers without a CTM.
- `DrmModeset` sets it again after each modeset, so a new monitor or a VT
  switch keeps it. The compositor sends it again after an engine restart.
- A nested desktop does nothing: the host compositor owns the screen.
- Not yet: `wlr-gamma-control` for clients such as gammastep.
