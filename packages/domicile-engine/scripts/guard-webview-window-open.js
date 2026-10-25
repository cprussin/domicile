// The shell module guard-webview-window-open.sh loads: one browser window
// under a strip of shell UI, and any window its page opens. The pages are
// guard-webview-window-open-server.py's.
//
// - A shell is a module the engine loads into its own document (see
//   ShellURLLoaderFactory::ShellDocument), so the guard ships a module, not
//   HTML.
// - It must be served from domicile:// because the browser binds
//   WebViewGuestHost only for the shell's origin.
// - It logs presses on its own strip, so a missing reading later means
//   something: without one, no press reached this browser.
// - It draws each window the desk lists in a second <webview>, as a shell
//   does, and logs `GUARD new-window url=…` each time its address changes.

export const HostShell = (_root, desktop) => {
  /**
   * Reads a required query parameter. Throws when missing: a default would
   * measure a setup the guard did not ask for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-window-open: ?${name}= is required`);
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

  // Sized rather than stretched between insets: see
  // guard-webview-routed-link.js.
  const view = document.createElement("webview");
  view.style.position = "absolute";
  view.style.insetBlockStart = stripHeight;
  view.style.insetInline = "0";
  view.style.inlineSize = "100%";
  view.style.blockSize = `calc(100% - ${stripHeight})`;
  view.style.border = "0";

  // Shows the harness can deliver a press to this document.
  strip.addEventListener("mousedown", () => {
    say("chrome-mousedown");
  });

  // This document's own `<webview src>` is in no list, so every listed window
  // is one a page opened. Drawn over the first; the guard reads the pages, not
  // their positions.
  //
  // Each window's last reported address. A page's new window is listed
  // before its first navigation commits, so its address can arrive in a
  // later change.
  const reported = new Map();
  desktop.addEventListener("browserwindowschanged", () => {
    for (const window of desktop.browserWindows) {
      if (reported.get(window.id) !== window.url) {
        say(`new-window url=${window.url}`);
      }
      if (!reported.has(window.id)) {
        const opened = document.createElement("webview");
        opened.style.position = "absolute";
        opened.style.insetBlockStart = stripHeight;
        opened.style.insetInline = "0";
        opened.style.inlineSize = "100%";
        opened.style.blockSize = `calc(100% - ${stripHeight})`;
        opened.style.border = "0";
        // Set before attaching: the element requests its page on attach.
        opened.setAttribute("window", window.id);
        document.body.append(opened);
      }
      reported.set(window.id, window.url);
    }
  });

  document.body.style.margin = "0";
  document.body.append(strip);

  // Set `src` after the element is in the document. `src` makes the <webview>
  // ask for a guest, and before insertion there is no frame to attach it to.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
