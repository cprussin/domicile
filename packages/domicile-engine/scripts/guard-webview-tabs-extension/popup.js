// Popup for guard-webview-tabs.sh. It queries the active tab in the current
// window, zooms that tab, and reads the zoom back.
//
// The result goes into this page's own address, `?active=<url>&zoom=<f>`,
// because the shell sees each page the <webview> shows via
// `domicile-page-change`. `active` is the tab's url when exactly one tab
// matched, else `count-<n>`, so an empty result still reports.
//
// The manifest requests the `tabs` permission; without it the url is blank.
//
// Read off `globalThis` because the linter does not know the `chrome` global.
const { tabs } = globalThis.chrome;

// The guard expects this as "1.50".
const ZOOM = 1.5;

const answer = (found) =>
  found.length === 1 ? found[0].url : `count-${found.length}`;

const say = (active, zoom) => {
  const query = new URLSearchParams({ active, zoom });
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

// Run only on first load; the reload from `say` carries `?active=`.
if (!new URLSearchParams(location.search).has("active")) {
  tabs.query({ active: true, currentWindow: true }).then(
    (found) =>
      zoomAnswer(found).then((zoom) => {
        say(answer(found), zoom);
      }),
    (error) => {
      say(`error-${error.message}`, "no-tab");
    },
  );
}
