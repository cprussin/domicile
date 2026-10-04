// The shell module guard-extension-installer.sh loads: one <webview> on the
// witness color, like guard-webview-content-script.js.
//
// It differs in two ways because the extension installs while the page is up:
//
// - It registers a listener to bind the control channel, which carries the
//   extension list (see DomicileHost::AddedEventListener).
// - It reloads the <webview> every second, because a content script runs only
//   in pages loaded after its extension installs, and nothing signals when the
//   asynchronous install finishes.
//
// The engine's document calls `Shell` once the module loads.

export const Shell = (_root, desktop) => {
  /**
   * Reads a required query parameter. No default, so a misconfigured guard
   * fails instead of measuring the wrong thing.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-extension-installer: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const RELOAD_EVERY_MS = 1000;

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-extension-installer: no desktop was handed to Shell, so this" +
        " document was not served by the forked engine",
    );
  }
  host.addEventListener("displayschanged", () => {
    /* only here to bind the channel */
  });
  console.log("GUARD listening");

  const parameters = new URLSearchParams(location.search);
  const view = document.createElement("webview");

  // Inset on the witness, as in guard-webview-content-script.js.
  view.style.position = "absolute";
  view.style.left = "10%";
  view.style.top = "10%";
  view.style.width = "80%";
  view.style.height = "70%";
  view.style.border = "0";

  document.body.style.background = `#${required(parameters, "witness")}`;

  // Set `src` after attaching: it requests a guest, which needs a frame.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));
  setInterval(() => {
    view.reload();
  }, RELOAD_EVERY_MS);
};
