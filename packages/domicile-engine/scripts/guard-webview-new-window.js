// The shell module guard-webview-new-window.sh loads: one browser window, and
// any second window its page opens.
//
// It must be a domicile:// document: the browser binds WebViewGuestHost only
// for the shell's origin. See ShellURLLoaderFactory::ShellDocument.
//
// Tests a `target="_blank"` link inside a browser window. A guest has no
// SiteInstance of its own, which keeps the user logged in, but content CHECKs
// for one in `WebContentsImpl::CreateNewWindow`. So the browser refuses
// content's window and opens a desk browser window at that address instead.
// The shell gets `browserwindowschanged` with an undrawn window in
// `browserWindows`, and draws it in a second `<webview>` naming the window.
//
// The guard requires the second view, since a window in the list is not on
// screen. The second element's page logging that it ran cannot be faked by an
// earlier step.
//
// The strip stands in for the shell's address bar. The guard clicks it to
// prove clicks reach this document, so "the link opened nothing" is
// distinguishable from "no click was delivered".
//
// Console output, which the engine writes to its log:
//
//   GUARD shell-loaded          this module ran and the window is set up
//   GUARD chrome-mousedown      a press reached the shell's document (harness
//                               check)
//   GUARD new-window url=…      an undrawn browser window appeared in the
//                               desk's list, with its address
//   GUARD second-view           the shell created a second <webview> for it
//   GUARD second-page url=…     the second <webview> shows that page
//
// The window's page logs `GUARD opener-loaded` and `GUARD guest-mousedown`, and
// the new window's page logs `GUARD opened-loaded`; see
// guard-webview-new-window-server.py.
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
      throw new Error(`guard-webview-new-window: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);

  // The shell's strip above the element. A plain <div> that never takes focus
  // or navigates, so window events here come from the element below.
  const stripHeight = `${required(parameters, "strip")}px`;
  const strip = document.createElement("div");
  strip.style.position = "absolute";
  strip.style.insetBlockStart = "0";
  strip.style.insetInline = "0";
  strip.style.inlineSize = "100%";
  strip.style.blockSize = stripHeight;
  strip.style.background = "#204060";

  /**
   * Creates a <webview> filling the window below the strip.
   *
   * Sets an explicit size: a <webview> is a replaced element, so with `auto`
   * size between insets it takes its intrinsic 300x150 and clicks miss it.
   */
  const viewFilling = () => {
    const view = document.createElement("webview");
    view.style.position = "absolute";
    view.style.insetBlockStart = stripHeight;
    view.style.insetInline = "0";
    view.style.inlineSize = "100%";
    view.style.blockSize = `calc(100% - ${stripHeight})`;
    view.style.border = "0";
    return view;
  };

  // This document's own `<webview src>` is in no list, so every listed window
  // is one a page opened.
  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-new-window: no desktop was handed to Shell, so this" +
        " document is not a shell the engine serves",
    );
  }
  const drawn = new Set();
  host.addEventListener("browserwindowschanged", () => {
    for (const window of host.browserWindows ?? []) {
      if (!drawn.has(window.id)) {
        drawn.add(window.id);
        say(`new-window url=${window.url}`);

        // Draw the window in a second element over the first; the guard checks
        // the page arrives, not its position. Set `window` before attaching,
        // since the element requests its page on attach.
        const opened = viewFilling();
        opened.setAttribute("window", window.id);
        // Report what the element shows: the window's page loads whether or
        // not anything draws it.
        opened.addEventListener("domicile-page-change", () => {
          say(`second-page url=${opened.url}`);
        });
        document.body.append(opened);
        say("second-view");
      }
    }
  });

  // Proves presses reach this document, so a missing reading elsewhere means
  // something.
  document.addEventListener("mousedown", (event) => {
    say(`chrome-mousedown target=${event.target.localName}`);
  });

  document.body.style.margin = "0";
  document.body.append(strip);

  // Set `src` after attaching: it requests a guest, which needs a frame.
  const view = viewFilling();
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
