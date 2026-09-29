// The first line of most popups, and what guard-webview-tabs.sh is about:
// which tab is the active one in the current window.
//
// THE ANSWER IS WRITTEN INTO THIS PAGE'S OWN ADDRESS, `?active=<url>`, because
// the address is what the shell can read: the <webview> reports every page it
// shows as `domicile-page-change`. One tab names its url; anything else names
// how many there were, `count-<n>`, so "no tab" is an answer and not silence.
//
// `tabs` is asked for in the manifest, without which the url is scrubbed.
//
// Off `globalThis` because `chrome` is an extension's global, which the linter
// this repository runs over every script does not know.
const { tabs } = globalThis.chrome;

const answer = (found) =>
  found.length === 1 ? found[0].url : `count-${found.length}`;

const say = (what) => {
  location.replace(`popup.html?active=${encodeURIComponent(what)}`);
};

// A query that failed says so the same way: `error-<message>`.
if (!new URLSearchParams(location.search).has("active")) {
  tabs.query({ active: true, currentWindow: true }).then(
    (found) => {
      say(answer(found));
    },
    (error) => {
      say(`error-${error.message}`);
    },
  );
}
