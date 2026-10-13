// The history reader for guard-webview-app-window.sh. After each visit to an
// http page, it searches the whole history and reports which of the guard's
// pages are in it to the page server that served the visit:
//
//   GUARD history subject=0|1 sentinel=0|1
//
// The guard reads the server's log, so the reading does not depend on the
// engine logging a service worker's console.
//
// Read from `globalThis` because the linter does not know the `chrome` global.
const { history } = globalThis.chrome;

const PAGES = ["subject", "sentinel"];

/** Searches the history and reports which of `PAGES` it holds to `origin`. */
const report = async (origin) => {
  const items = await history.search({
    maxResults: 1000,
    startTime: 0,
    text: "",
  });
  const paths = new Set(items.map((item) => new URL(item.url).pathname));
  const held = PAGES.map((page) => `${page}=${paths.has(`/${page}`) ? 1 : 0}`);
  const line = `history ${held.join(" ")}`;
  await fetch(`${origin}/report?line=${encodeURIComponent(line)}`);
};

history.onVisited.addListener(({ url }) => {
  const visited = new URL(url);
  if (visited.protocol === "http:") {
    report(visited.origin).catch((error) => {
      console.error(`GUARD history-failed ${error.message}`);
    });
  }
});
