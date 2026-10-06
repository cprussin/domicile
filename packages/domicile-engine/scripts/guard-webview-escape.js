// Shell for guard-webview-escape.sh: one browser window, with the keyboard
// left in the shell's document.
//
// A module, because the engine writes the shell document and loads one module
// (see ShellURLLoaderFactory::ShellDocument). Loaded on a domicile:// page, the
// only origin WebViewGuestHost is bound for.
//
// Do not focus the window. The crash is on the embedder's (shell's)
// WebContents, through the `BrowserPluginEmbedder` an attach creates there. A
// focused guest handles keys in its own WebContents and cannot reach it.
// `guard-webview-keyboard.js` does the opposite on purpose.
//
// Logs `GUARD document-keydown code=…` for diagnostics only: a headless window
// may get no key events in the page. The guard reads `guest-loaded` from
// guard-webview-guest-page.py to know the shell is an embedder.
//
// Domicile calls `Shell` once the module loads.

export const Shell = () => {
  /**
   * Reads a required query parameter. No default, so a misconfigured run fails.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-escape: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);
  const view = document.createElement("webview");

  view.style.position = "absolute";
  view.style.inset = "0";
  view.style.inlineSize = "100%";
  view.style.blockSize = "100%";
  view.style.border = "0";

  document.addEventListener("keydown", (event) => {
    say(`document-keydown code=${event.code}`);
  });

  // Set `src` after attaching: it requests the guest, which needs a frame.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));
};
