// The shell module guard-webview-routed-link.sh loads: one browser window whose
// page holds a single link.
//
// - A shell is a module the engine loads into its own document (see
//   ShellURLLoaderFactory::ShellDocument), so the guard ships a module, not
//   HTML.
// - It must be served from domicile:// because the browser binds
//   WebViewGuestHost only for the shell's origin.
// - It logs presses on its own strip, so a missing reading later means
//   something: without a press here, the click never reached this browser.
// - It logs the desk's browser-window list. A middle click on the link should
//   add a window at the link's address.

export const Shell = (_root, desktop) => {
  /**
   * Reads a required query parameter. Throws when missing: a default would
   * measure a setup the guard did not ask for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-routed-link: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);

  // The shell's strip above the <webview>. The guard's first press lands here.
  const stripHeight = `${required(parameters, "strip")}px`;
  const strip = document.createElement("div");
  strip.style.position = "absolute";
  strip.style.insetBlockStart = "0";
  strip.style.insetInline = "0";
  strip.style.inlineSize = "100%";
  strip.style.blockSize = stripHeight;
  strip.style.background = "#204060";

  // The browser window's page. Sized explicitly: a <webview> is a replaced
  // element, so with `auto` size between two insets it takes its intrinsic
  // 300x150 and the guard's press misses it.
  const view = document.createElement("webview");
  view.style.position = "absolute";
  view.style.insetBlockStart = stripHeight;
  view.style.insetInline = "0";
  view.style.inlineSize = "100%";
  view.style.blockSize = `calc(100% - ${stripHeight})`;
  view.style.border = "0";

  // Shows the harness can deliver a press to this document.
  document.addEventListener("mousedown", (event) => {
    say(`chrome-mousedown target=${event.target.localName}`);
  });

  // Logs each browser window in the desk's list with its address, so a window
  // at the wrong page cannot pass.
  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-routed-link: no desktop was handed to Shell, so this" +
        " document is not a shell the engine serves",
    );
  }
  host.addEventListener("browserwindowschanged", () => {
    for (const window of host.browserWindows ?? []) {
      say(`new-window url=${window.url}`);
    }
  });

  // A middle click must not navigate this guest. Read from the element because
  // /opened also loads in the new window, so the page's own log cannot tell
  // the two apart.
  view.addEventListener("domicile-page-change", () => {
    say(`first-page url=${view.url}`);
  });

  document.body.style.margin = "0";
  document.body.append(strip);

  // Set `src` after the element is in the document. `src` makes the <webview>
  // ask for a guest, and before insertion there is no frame to attach it to.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
