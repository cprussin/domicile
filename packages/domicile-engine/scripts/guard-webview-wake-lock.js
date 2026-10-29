// The shell module guard-webview-wake-lock.sh loads: one browser window filling
// the page. The window's page is guard-webview-wake-lock-server.py's.
//
// - A shell is a module the engine loads into its own document (see
//   ShellURLLoaderFactory::ShellDocument), so the guard ships a module, not
//   HTML.
// - It must be served from domicile:// because the browser binds
//   WebViewGuestHost only for the shell's origin.
// - It logs each `domicile-wake-lock-change` with the element's `wakeLock`.

export const HostShell = () => {
  /**
   * Reads a required query parameter. Throws when missing: a default would
   * measure a setup the guard did not ask for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-wake-lock: ?${name}= is required`);
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
  view.style.insetBlockStart = "0";
  view.style.insetInline = "0";
  view.style.inlineSize = "100%";
  view.style.blockSize = "100%";
  view.style.border = "0";

  // The claim. Listened for on the document because shells rely on it
  // bubbling.
  document.addEventListener("domicile-wake-lock-change", () => {
    say(`webview-wake-lock=${view.wakeLock}`);
  });

  document.body.style.margin = "0";

  // Set `src` after the element is in the document. `src` makes the <webview>
  // ask for a guest, and before insertion there is no frame to attach it to.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
