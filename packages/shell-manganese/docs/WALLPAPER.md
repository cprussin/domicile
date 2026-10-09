# The wallpaper

A photograph behind the whole desktop, changing every minute. Source:
`src/wallpaper/`.

- **One copy per screen**, cropped to that monitor, so nothing is drawn in
  the gaps between monitors of different sizes. All copies show the same
  photo. Until the compositor reports the screens, one copy covers the page.
- **Each theme has its own rotation**: dark space photos for dark, bright
  nature scenes for light. Both rotate together; CSS shows the current theme's.
  A theme switch shows an already loaded photo.
- **Mounted**: only the photo on screen, the one fading out and the next one.
  The next one mounts a full minute early, so it has loaded before its turn.
- **Crossfade**: the incoming photo fades in over the outgoing one, which
  stays opaque underneath, so the background never shows through. `isolation: isolate` keeps their `z-index` from stacking over the
  chrome.
- **Photos**: `photos.ts` lists public-domain and CC0 Wikimedia Commons files by
  title, fetched via `Special:FilePath?width=`. The same photos always show,
  and the browser caches them. No credit line is needed.
- **Offline**: each theme has one photo in the repo
  (`src/wallpaper/fallback-*.jpg`) under its rotation. A remote photo stays
  transparent until it loads.
- **Retries**: a photo that fails to load retries after 1s, doubling the wait
  up to 60s, until it loads. The network can be down, or up with no internet,
  for any length of time.
- To use other photos, edit `photos.ts`.
- **A picture an application set** through the Wallpaper portal replaces the
  rotation on every screen, and the lock screen shows its own over the blur.
  Both come from `usePortalWallpaper` and are read with `usePictureUrl`, both
  in `@domicile-desktop/component-library`. See
  [PORTALS.md](/docs/PORTALS.md).
