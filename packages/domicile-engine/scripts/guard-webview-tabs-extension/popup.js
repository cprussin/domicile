// Popup for guard-webview-tabs.sh. It queries the active tab in the current
// window, zooms that tab, reads the zoom back, and lists the tab's frames.
//
// The result goes into this page's own address,
// `?active=<url>&frames=<url>&zoom=<f>`,
// because the shell sees each page the <webview> shows via
// `domicile-page-change`. `active` is the tab's url when exactly one tab
// matched, else `count-<n>`, so an empty result still reports.
//
// The manifest requests the `tabs` permission; without it the url is blank.
// It requests `webNavigation` for getAllFrames, which password managers such as
// 1Password fill through.
//
// Read off `globalThis` because the linter does not know the `chrome` global.
const { tabs, webNavigation } = globalThis.chrome;

// The guard expects this as "1.50".
const ZOOM = 1.5;

const answer = (found) =>
  found.length === 1 ? found[0].url : `count-${found.length}`;

const say = (active, zoom, frames) => {
  const query = new URLSearchParams({ active, frames, zoom });
  location.replace(`popup.html?${query}`);
};

/**
 * Zooms `tab` and returns the zoom tabs.getZoom reads back, or
 * `error-<message>` on failure.
 */
const zoomed = (tab) =>
  tabs
    .setZoom(tab.id, ZOOM)
    .then(() => tabs.getZoom(tab.id))
    .then(
      (factor) => factor.toFixed(2),
      (error) => `error-${error.message}`,
    );

const zoomAnswer = (found) =>
  found.length === 1 ? zoomed(found[0]) : Promise.resolve("no-tab");

/**
 * Returns the url of the top frame webNavigation.getAllFrames lists for `tab`,
 * else `count-<n>` for the frames it listed, `no-tab` when it found no such
 * tab, or `error-<message>` on failure.
 */
const topFrame = (tab) =>
  webNavigation.getAllFrames({ tabId: tab.id }).then(
    (frames) => (frames === null ? "no-tab" : topFrameUrl(frames)),
    (error) => `error-${error.message}`,
  );

const topFrameUrl = (frames) => {
  const top = frames.filter((frame) => frame.frameId === 0);
  return top.length === 1 ? top[0].url : `count-${frames.length}`;
};

const framesAnswer = (found) =>
  found.length === 1 ? topFrame(found[0]) : Promise.resolve("no-tab");

// Run only on first load; the reload from `say` carries `?active=`.
if (!new URLSearchParams(location.search).has("active")) {
  tabs.query({ active: true, currentWindow: true }).then(
    (found) =>
      Promise.all([zoomAnswer(found), framesAnswer(found)]).then(
        ([zoom, frames]) => {
          say(answer(found), zoom, frames);
        },
      ),
    (error) => {
      say(`error-${error.message}`, "no-tab", "no-tab");
    },
  );
}
