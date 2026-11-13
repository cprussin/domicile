# Color: 10-bit and HDR output

Domicile takes 10-bit and floating-point client buffers, scans out in 10 bits
where a display takes it, tells clients each display's color through
`wp_color_management_v1`, and drives a display in HDR when its placement asks
for it. Chromium already composites in a display's color space and drives
`Colorspace` and `HDR_OUTPUT_METADATA` on DRM (ChromeOS's path). Domicile
switches that path on and adds the parts Chromium lacks: client formats and
color descriptions, the protocol, and the config. Tracks
[#1974](https://github.com/cprussin/domicile/issues/1974).

## Design

```
 client ──dmabuf + fourcc──────────────▶ compositor ──ImportBuffer(fourcc,  ──▶ viz: SharedImage in
   │                                      │            color description)        the buffer's color
   └─ wp_color_management_surface_v1 ────▶│                                       space, composited
      (image description)                 │                                       into the display's
                                          │                                              │
 client ◀── output / preferred image ─────┤◀── DomicileDisplays: color space,            ▼
            description                   │    HDR capable, luminances       DrmDisplay: plane format,
                                          │                                  Colorspace, HDR_OUTPUT_
 profile: hdr, bit_depth ─────────────────┴──▶ DomicileDisplayLayout ──────▶ METADATA, max bpc
```

| Piece | Where | Does |
|---|---|---|
| Importable formats | engine `FormatFromFourcc`, compositor `FOURCCS` | One list in two places, kept equal by `test-the-engines-fourccs-agree.sh`. The compositor advertises the ones its renderer also imports, on `zwp_linux_dmabuf_v1` and `wl_shm` |
| Buffer color | `ImportBuffer` / `domicile_surface_import_*` | Each import carries the surface's color description. The engine builds the `SharedImage` in that `gfx::ColorSpace` and sets its `gfx::HDRMetadata`, in place of sRGB |
| Display color | `drm_screen.cc` | Builds each `display::Display`'s `gfx::DisplayColorSpaces` from the EDID and the layout: SDR, or HDR10 with an SDR white level and the panel's peak luminance. Output format is `RGBA_1010102` at 10 bits |
| Scanout | Chromium `DrmDisplay`, `HardwareDisplayController` | HDR10 sets `Colorspace` to `BT2020_RGB` and writes `HDR_OUTPUT_METADATA`. Domicile adds `max bpc` and the 10-bit plane format, with an 8-bit fallback |
| Protocol | `domicile-compositor` (`color_management.rs`) | `wp_color_manager_v1`, per-output and per-surface image descriptions, preferred description feedback. Smithay has none; the global is built on `wayland-protocols`' staging server bindings |
| Config | `domicile-config` placement: `hdr`, `bit_depth` | Per display. Settings shows an HDR switch and an SDR brightness slider for displays that report HDR |
| Night light | `gamma.rs`, engine | On an HDR display it is a color matrix in viz's linear composition. `wlr-gamma-control` fails for that display |

## Key decisions

- **Chromium's color pipeline over our own.** Viz already converts each quad
  from its `gfx::ColorSpace` to the display's, tone-maps HDR content and
  composites SDR at a set white level. Browser windows (HDR video, CSS
  `dynamic-range: high`) get HDR from the same switch as native clients.
- **A format is listed only with a pixel guard.** #663's blank windows came
  from advertising formats the engine refused, which the agreement test now
  catches. A format the engine accepts can still draw wrong, so
  `guard-buffer-formats.sh` has a `wl_shm` client draw a known color in each
  listed format and reads it back from viz.
- **Formats:** `ARGB2101010`, `ABGR2101010` (viz `BGRA_1010102`,
  `RGBA_1010102`) and `ABGR16161616F` (`RGBA_F16`). Viz has no deep format
  without alpha, and its twin with alpha draws padding as alpha even when
  marked opaque, so `XRGB2101010`, `XBGR2101010` and `XBGR16161616F` are
  offered only on `wl_shm`, where the compositor copies each frame into the
  twin with alpha filled in. On the software compositor the 8-bit set only:
  viz's software path draws no 10-bit image.
- **HDR is opt-in per display (`hdr = true`).** An HDR mode changes how SDR
  content looks and some panels dim or flicker in it, as in sway, KDE and
  GNOME. A display whose EDID has no BT.2020 + PQ ignores it and reports that.
- **`bit_depth` defaults to 8, `hdr` implies 10.** Some drivers and adapters
  light a 10-bit plane black or banded. `bit_depth = 10` asks for it on SDR.
  The atomic test commit picks 8 bits when the plane or connector refuses 10,
  and the display reports what it got. The DisplayLink dock (evdi) takes only
  `XRGB8888`.
- **SDR white is 203 nits by default** (ITU-R BT.2408), set per display from
  Settings. It is the white level viz composites SDR content at, and the
  reference white the protocol tells clients.
- **Protocol features:** parametric descriptions with named primaries (sRGB,
  BT.2020, Display P3, Adobe RGB), named transfer functions (gamma 2.2,
  compound power 2.4, BT.1886, ext linear, ST 2084 PQ, HLG), luminances,
  mastering display primaries, extended target volume and Windows scRGB (for
  games under Proton). Perceptual intent only. No ICC: viz takes no ICC per
  quad, and ICC clients are rare.
- **Output descriptions follow the display.** SDR: the EDID primaries with
  gamma 2.2. HDR: BT.2020 with PQ, the panel's luminances from the EDID and
  the SDR white as reference. A surface's preferred description is its main
  display's, and changes when the window moves or the display's mode does.
- **Night light on HDR is a viz color matrix.** A gamma ramp after PQ encoding
  bends the curve the panel decodes. Viz's display color matrix applies in
  linear light before encoding. Gamma ramps from clients assume SDR, so
  `wlr-gamma-control` reports `failed` on an HDR display.
- **Captures are SDR.** Screenshots, casts and screencopy stay 8-bit sRGB;
  viz tone-maps the copy.

## Plan

- [x] engine + compositor: 10-bit and F16 formats in `FormatFromFourcc` and `FOURCCS`, on `wl_shm` too; `guard-buffer-formats.sh`
- [ ] config + engine: `bit_depth` per placement; 10-bit plane format and `max bpc`, 8-bit fallback; reported per display
- [ ] engine: buffer color descriptions on import (`gfx::ColorSpace`, `gfx::HDRMetadata`)
- [ ] compositor: `wp_color_management_v1` with output and surface descriptions and preferred feedback
- [ ] engine: HDR10 display color spaces from the EDID and the layout; `Colorspace`, `HDR_OUTPUT_METADATA`
- [ ] config: `hdr` and SDR white per placement; HDR capability reported per display
- [ ] engine + compositor: night light as a viz color matrix on HDR displays; `wlr-gamma-control` fails there
- [ ] Settings: HDR switch and SDR brightness for HDR displays (mockup first)

## Open questions

- **Settings or config only for `bit_depth`?** Recommend config only: it
  fixes banding on panels that need it, and a person can't tell from Settings
  whether theirs does.
