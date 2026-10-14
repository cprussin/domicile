// The history reader for guard-webview-app-window.sh. It searches the whole
// history and reports which of the guard's pages are in it to the page server
// that served them:
//
//   GUARD history subject=0|1 sentinel=0|1
//
// It reports after each visit to an http page, and once when the worker
// starts. On a loaded machine the worker can start after the guard's visits,
// and `onVisited` drops a visit that happens before its listener is
// registered, so only the search at start sees those.
//
// The guard reads the server's log, so the reading does not depend on the
// engine logging a service worker's console.
//
// Read from `globalThis` because the linter does not know the `chrome` global.
const { history } = globalThis.chrome;

const PAGES = ["subject", "sentinel"];

const search = () =>
  history.search({
    maxResults: 1000,
    startTime: 0,
    text: "",
  });

/** Searches the history and reports which of `PAGES` it holds to `origin`. */
const report = async (origin) => {
  const items = await search();
  const paths = new Set(items.map((item) => new URL(item.url).pathname));
  const held = PAGES.map((page) => `${page}=${paths.has(`/${page}`) ? 1 : 0}`);
  const line = `history ${held.join(" ")}`;
  await fetch(`${origin}/report?line=${encodeURIComponent(line)}`);
};

/** Reports to the origin of each http page the history already holds. */
const reportHeld = async () => {
  const items = await search();
  const origins = new Set(
    items
      .map((item) => new URL(item.url))
      .filter((url) => url.protocol === "http:")
      .map((url) => url.origin),
  );
  await Promise.all([...origins].map(report));
};

const failed = (error) => {
  console.error(`GUARD history-failed ${error.message}`);
};

// Registered before the search below starts, so every visit is either already
// in the history the search reads or heard here.
history.onVisited.addListener(({ url }) => {
  const visited = new URL(url);
  if (visited.protocol === "http:") {
    report(visited.origin).catch(failed);
  }
});

reportHeld().catch(failed);
