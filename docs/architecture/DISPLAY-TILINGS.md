# Display tilings

How cc rasters the one desk page so each monitor gets tiles at its own scale.
Part of [ONE-PAGE-FOR-THE-DESK.md](ONE-PAGE-FOR-THE-DESK.md).

Upstream cc keeps one high-res tiling per layer, at S (the largest scale on the
desk). Patch 0072 (`cc/domicile/display_regions.h`) also keeps a tiling at each
lower monitor scale the layer appears on, so each monitor gets tiles rastered
1:1 for its pixels.

## Design

- **Regions.** The browser adds every lit monitor to the page's screens
  (`DeskScreenInfos`, labeled `cc::kDomicileDisplayLabel`, placed by
  `DomicileDeskScreenInfosFor`). `WidgetBase` turns them into viewport regions
  in device pixels, each with ratio `s_i/S` (`DomicileDisplayRegionsOf`), and
  passes them to `LayerTreeHost::SetDomicileDisplayRegions`. A `<webview>`
  finds its regions from its own screen rect.
- **Tilings.** On both trees, `PictureLayerImpl::UpdateDomicileDisplayTilings`
  adds a tiling at high-res scale × each ratio the layer touches (at most
  three), using its screen space transform.
  - Priority rects are clipped to the monitor's region, so gaps and other
    monitors are never rastered at that scale.
  - The tiling is NON_IDEAL but still gets tiles.
    `CleanUpTilingsOnActiveLayer` keeps it while the monitor shows the layer.
- **Activation** (patch 0079). The pending tree's tiling mirrors the active
  one and rasters what a commit invalidated. Activation waits on those tiles
  like high-res ones (`IsTileRequiredForActivation`,
  `TilingSetRasterQueueRequired`). So a monitor never flashes a downscaled
  high-res tile.
- **Raster order.** `TilingSetRasterQueueAll` rasters each display tiling after
  the high-res tiling in every bin.
- **Draw.** `TileBasedLayerImpl::AppendQuads` covers each region from its
  tiling (`DomicileCoverage`). It falls back to high res where a tile is not
  ready: on first raster or after eviction.

Viz then scales by `s_i/S`, so a tile rastered at `s_i` maps 1:1 to display
`i`'s pixels.

Cost: the high-res tiling still covers the whole layer, so a lower-density
monitor adds raster work and activation latency.

## Fallback to S

These layers raster only at S. Viz resamples them on a lower-density display.

- layers under a non-root render surface: filters, blur, masks, opacity
  groups (such as a window dragged at reduced opacity)
- rotated layers
- directly composited images

A layer under a surface keeps its display tilings rastered
(`DomicileKeepsDisplayTilings`), so leaving the surface needs no rebuild. A
moving layer draws from its tilings.

## Tile memory

- Budget (`GetGpuMemoryPolicy`): 1152 MB scaled by the widget's initial screen
  area, at least 512 MB, at most a quarter of RAM.
  `--force-gpu-mem-available-mb` overrides it.
- The shell's page is created before it learns it spans the desk, so that
  initial screen is the host monitor alone. `domicile-launch` therefore passes
  `--force-gpu-mem-available-mb=3072` (`DESK_TILE_MEMORY_MB` in `spawn.rs`).
- A ~40 Mpx desk at S needs ~160 MB of tiles per full-desk layer. A monitor at
  ratio `r` adds `r²` of its share.
- Over budget, required tiles are marked OOM and drawn as checkerboard. So
  when memory is tight, a display tiling is worse than resampling.
