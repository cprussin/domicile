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
  connector order. This also undoes a profile that turned a panel off.
- **Non-empty layout:** a connector the layout does not name stays dark. This
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
| `wm::CursorLoader` | Rotates and scales the cursor image |

- A window is the monitor's logical box, upright. A 4K panel rotated at scale
  1.2 is a window of 1800×3200 DIPs.
- Each `<app>` element passes its scale (patch `0044`, `configure_at`) so the
  compositor can convert the box from the page's device pixels to the logical
  pixels a configure uses.
- `rotate-270` turns content a quarter clockwise, for a panel on its left side.
  This matches `wl_output` and kanshi. `RotationOf` in `drm_screen.cc` converts.
- **Known gap:** the compositor ignores `wl_surface.set_buffer_transform`. A
  client that pre-rotates its buffer would be rotated twice. The fix belongs in
  the dmabuf submit path.

## Shell windows

Each display gets its own browser window, and one shell page spans them all:
[ONE-PAGE-FOR-THE-DESK.md](architecture/ONE-PAGE-FOR-THE-DESK.md). On a
hotplug, `ShellWindows` opens new windows before closing old ones and never
closes the last window, since that would exit the browser.

## Monitor names

A profile's `display` matches any of:

- the `wl_output` name, `drm-<id>`;
- the description, `"<MAKE> <MODEL> <SERIAL>"`, as kanshi and sway use;
- the description with the maker's full name.

Example: `Dell Inc. DELL U3219Q 2ZLS413`, `DEL DELL U3219Q 2ZLS413` or
`drm-<id>`. Without hwdata's PNP table, the description uses the three-letter
code and the compositor logs one line at startup.

- The label travels as `display::Display::label` → the mojom `Display` →
  `const char*` on `DomicileDisplay`.
- `ui/ozone/platform/drm/domicile/edid_name.cc` reads the serial from the EDID.
  `display::EdidParser` keeps only a hash, and the serial is what tells
  identical monitors apart. The file uses no Chromium types, so it is tested
  outside a Chromium tree.
- `packages/domicile-compositor/src/pnp_ids.rs` expands the maker code from
  hwdata's `pnp.ids`, read at startup from `DOMICILE_PNP_IDS` (set by the
  flake's wrapper) or the distribution's path. It is read at run time because
  the table is GPL-2+ and this repo is MIT OR Apache-2.0.
- A monitor with no make, model or serial can only be named `drm-<id>`.

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
