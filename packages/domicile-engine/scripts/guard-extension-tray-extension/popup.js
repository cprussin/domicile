// A popup that, like Bitwarden's, calls runtime.getContexts and
// tabs.getCurrent to tell a popup from a tab, then closes itself.
// guard-extension-tray.sh reads the result from this page's address and the
// close as `domicile-close` on the <webview>.
//
// The result goes in the address, since the shell can read it:
// `?contexts=<types>&tab=<id>`.
//
// - `<types>`: this document's context types, comma-separated, `none`, or
//   `error-<message>`. Chrome reports a toolbar popup as `POPUP` and a tab as
//   `TAB`.
// - `<id>`: the tabs.getCurrent() id, or `none` (Chrome's answer for a popup).
//
// Each step waits a second after load so the shell logs the page's address
// first, in case the step crashes the browser.
//
// Read from `globalThis` because the linter does not know the `chrome` global.
const { runtime, tabs } = globalThis.chrome;

const AFTER_MS = 1000;

/** Runs `then` a second after this page loads. */
const later = (then) => {
  window.addEventListener("load", () => {
    setTimeout(then, AFTER_MS);
  });
};

const say = (contexts, tab) => {
  location.replace(`popup.html?${new URLSearchParams({ contexts, tab })}`);
};

const ours = (found) => {
  const types = found
    .filter((context) => context.documentUrl === location.href)
    .map((context) => context.contextType)
    .join(",");
  return types === "" ? "none" : types;
};

if (new URLSearchParams(location.search).has("contexts")) {
  later(() => {
    window.close();
  });
} else {
  later(() => {
    Promise.all([runtime.getContexts({}), tabs.getCurrent()]).then(
      ([found, tab]) => {
        say(ours(found), tab === undefined ? "none" : String(tab.id));
      },
      (error) => {
        say(`error-${error.message}`, "error");
      },
    );
  });
}
