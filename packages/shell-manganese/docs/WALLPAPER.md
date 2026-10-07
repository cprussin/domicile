# The wallpaper

A photograph behind the whole desktop, changing every minute. Source:
`src/wallpaper/`.

- **One copy per screen**, cropped to that monitor, so nothing is drawn in
  the gaps between monitors of different sizes. All copies show the same
  photo. Until the compositor reports the screens, one copy covers the page.
- **Each theme has its own rotation**: night skies for dark, daylit
  landscapes for light. Both rotate together; CSS shows the current theme's.
  A theme switch shows an already loaded photo.
- **Crossfade**: all photos stay mounted. The incoming one fades in over the
  outgoing one, which stays opaque underneath, so the background never shows
  through. `isolation: isolate` keeps their `z-index` from stacking over the
  chrome.
- **Photos**: `photos.ts` lists six public-domain Wikimedia Commons files by
  title, fetched via `Special:FilePath?width=`. The same photos always show,
  and the browser caches them. No credit line is needed.
- With no network, the theme's `background` shows instead.
- To use other photos, edit `photos.ts`.
- **A picture an application set** through the Wallpaper portal replaces the
  rotation on every screen, and the lock screen shows its own over the blur.
  Both come from `usePortalWallpaper` and are read with `usePictureUrl`. See
  [the portals README](/packages/domicile-compositor/src/portals/README.md).
