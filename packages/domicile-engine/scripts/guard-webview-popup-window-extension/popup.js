// What Bitwarden's sign-in does, and what guard-webview-popup-window.sh is
// about: a popup window of the extension's own, at a page of its own, at a
// size.
//
// THE ANSWER IS WRITTEN INTO THIS PAGE'S OWN ADDRESS,
// `?created=<id>&tabs=<n>`, because the address is what the shell can read:
// the <webview> reports every page it shows as `domicile-page-change`. A
// windows.create that failed says `created=error-<message>`; one that never
// answers says nothing, which is what the guard's control reads.
//
// Off `globalThis` because `chrome` is an extension's global, which the linter
// this repository runs over every script does not know.
const { windows } = globalThis.chrome;

const say = (answer) => {
  location.replace(`popup.html?${new URLSearchParams(answer)}`);
};

if (!new URLSearchParams(location.search).has("created")) {
  windows
    .create({ height: 360, type: "popup", url: "window.html", width: 420 })
    .then(
      (window) => {
        say({ created: window.id, tabs: window.tabs.length });
      },
      (error) => {
        say({ created: `error-${error.message}`, tabs: 0 });
      },
    );
}
