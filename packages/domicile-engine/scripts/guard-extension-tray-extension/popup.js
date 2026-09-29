// A popup that says it is done the way every extension's popup does: by
// closing itself. guard-extension-tray.sh reads that as `domicile-close` on the
// <webview> the shell opened it in.
//
// After a second rather than at once, so the shell has seen the popup's address
// before the close arrives: a close with no page before it would not say which
// page closed.
const CLOSE_AFTER_MS = 1000;

window.addEventListener("load", () => {
  setTimeout(() => {
    window.close();
  }, CLOSE_AFTER_MS);
});
