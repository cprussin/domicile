// Docs routes that moved, so links to the old ones keep working. Read by
// next.config.ts, so it imports nothing.

/** Each old route under `/docs/`, and the route it moved to. */
export const MOVED: Readonly<Record<string, string>> = {
  "manganese/casting": "manganese/monitors",
  "manganese/config": "manganese/settings",
  "manganese/displays": "manganese/monitors",
  "manganese/history": "manganese/browser",
  "manganese/idle": "manganese/lock",
  "manganese/launcher-sources": "manganese/launcher",
  "manganese/wallpaper": "manganese/appearance",
};

/** `MOVED` as Next's permanent redirects. */
export const movedRedirects = () =>
  Object.entries(MOVED).map(([from, to]) => ({
    destination: `/docs/${to}`,
    permanent: true,
    source: `/docs/${from}`,
  }));
