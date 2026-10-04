# The wallpaper

A photograph behind the whole desktop, changing every minute. Source:
`src/wallpaper/`.

- One `position: fixed` element spans every display. It is not in a
  `<Screen>`, so it shows before the compositor reports the screens.
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
