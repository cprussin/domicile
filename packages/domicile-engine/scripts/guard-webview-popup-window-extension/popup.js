// The extension popup for guard-webview-popup-window.sh. Like Bitwarden's
// sign-in, it opens a sized popup window at its own page.
//
// The result goes into this page's address, `?created=<id>&tabs=<n>`, which
// the shell reads from `domicile-page-change`. A failed windows.create writes
// `created=error-<message>`. One that never answers writes nothing, which is
// what the control expects.
//
// Read from `globalThis` because the linter does not know the `chrome` global.
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
