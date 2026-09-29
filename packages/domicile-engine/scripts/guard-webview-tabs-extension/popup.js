// The first line of most popups, and what guard-webview-tabs.sh is about:
// which tab is the active one in the current window. Then that tab zoomed,
// and its zoom read back.
//
// THE ANSWER IS WRITTEN INTO THIS PAGE'S OWN ADDRESS, `?active=<url>&zoom=<f>`,
// because the address is what the shell can read: the <webview> reports every
// page it shows as `domicile-page-change`. One tab names its url; anything else
// names how many there were, `count-<n>`, so "no tab" is an answer and not
// silence. `zoom` is what tabs.getZoom read after tabs.setZoom, to two places.
//
// `tabs` is asked for in the manifest, without which the url is scrubbed.
//
// Off `globalThis` because `chrome` is an extension's global, which the linter
// this repository runs over every script does not know.
const { tabs } = globalThis.chrome;

// What the tab is zoomed to. The guard reads it as "1.50".
const ZOOM = 1.5;

const answer = (found) =>
  found.length === 1 ? found[0].url : `count-${found.length}`;

const say = (active, zoom) => {
  const query = new URLSearchParams({ active, zoom });
  location.replace(`popup.html?${query}`);
};

/**
 * The one tab found zoomed, and its zoom as tabs.getZoom reads it back. A
 * failure says so the same way the query's does: `error-<message>`.
 */
const zoomed = (tab) =>
  tabs
    .setZoom(tab.id, ZOOM)
    .then(() => tabs.getZoom(tab.id))
    .then(
      (factor) => factor.toFixed(2),
      (error) => `error-${error.message}`,
    );

// Only a query that found one tab has a tab to zoom.
const zoomAnswer = (found) =>
  found.length === 1 ? zoomed(found[0]) : Promise.resolve("no-tab");

// A query that failed says so the same way: `error-<message>`.
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
