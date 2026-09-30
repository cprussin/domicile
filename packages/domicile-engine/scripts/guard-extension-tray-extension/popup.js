// A popup that does what Bitwarden's does on opening -- asks
// runtime.getContexts -- and then says it is done the way every extension's
// popup does: by closing itself. guard-extension-tray.sh reads the answer off
// this page's address and the close as `domicile-close` on the <webview> the
// shell opened it in.
//
// THE ANSWER IS WRITTEN INTO THIS PAGE'S OWN ADDRESS, `?contexts=<types>`, as
// guard-webview-tabs-extension's popup does, because the address is what the
// shell can read. `<types>` are the context types listed for this document,
// comma-separated, `none` for none, `error-<message>` for a refusal. Chrome
// lists an extension page in a tab as `TAB`.
//
// Each a second after its page loads rather than at once, so the shell has
// seen the page's address first: an answer that crashes the browser, or a
// close, with no page before it would not say which page it came from.
//
// Off `globalThis` because `chrome` is an extension's global, which the linter
// this repository runs over every script does not know.
const { runtime } = globalThis.chrome;

const AFTER_MS = 1000;

/** `then` a second after this page loads. */
const later = (then) => {
  window.addEventListener("load", () => {
    setTimeout(then, AFTER_MS);
  });
};

const say = (contexts) => {
  location.replace(`popup.html?${new URLSearchParams({ contexts })}`);
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
    runtime.getContexts({}).then(
      (found) => {
        say(ours(found));
      },
      (error) => {
        say(`error-${error.message}`);
      },
    );
  });
}
