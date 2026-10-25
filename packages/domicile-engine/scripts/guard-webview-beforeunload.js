// The shell module guard-webview-beforeunload.sh loads: one browser window
// under a strip of shell UI. The window's page is
// guard-webview-beforeunload-server.py's.
//
// - It logs presses on its own strip, so a missing reading later means
//   something: without one, no press reached this browser.
// - When the page reaches `#pressed`, it closes the window with
//   `closeBrowserWindow`.
// - It answers the first `beforeunload` with Cancel, checks the window is
//   still listed, and closes it again. It answers the second with Leave.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded                 this module ran
//   GUARD chrome-mousedown             a press reached the strip
//   GUARD closing                      it asked to close the window
//   GUARD dialog type=T message=M      a `domicile-dialog` reached it
//   GUARD still-open                   the window was listed after Cancel
//   GUARD window-closed                the window left the list
//
// Everything is inside `HostShell`, which Domicile's document calls once the module
// loads.

export const HostShell = (_root, desktop) => {
  /**
   * Reads a required query parameter. Throws when missing: a default would
   * measure a setup the guard did not ask for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-beforeunload: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-webview-beforeunload: no desktop was handed to Shell, so this" +
        " document was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const src = required(parameters, "src");

  // The shell's strip above the <webview>. The guard's first press lands here.
  const stripHeight = `${required(parameters, "strip")}px`;
  const strip = document.createElement("div");
  strip.style.position = "absolute";
  strip.style.insetBlockStart = "0";
  strip.style.insetInline = "0";
  strip.style.inlineSize = "100%";
  strip.style.blockSize = stripHeight;
  strip.style.background = "#204060";

  // Shows the harness can deliver a press to this document.
  strip.addEventListener("mousedown", () => {
    say("chrome-mousedown");
  });

  document.body.style.margin = "0";
  document.body.append(strip);

  // Long enough for a wrongly closed window to leave the list. The close
  // updates the list at once.
  const settleMs = 2000;

  let windowId;
  let closing = false;
  let stayed = false;

  const listed = () =>
    (desktop.browserWindows ?? []).some(({ id }) => id === windowId);

  // The claim. Listened for on the document because shells rely on it
  // bubbling.
  document.addEventListener("domicile-dialog", (event) => {
    event.preventDefault();
    say(`dialog type=${event.dialogType} message=${event.message}`);
    if (stayed) {
      event.accept();
    } else {
      stayed = true;
      event.dismiss();
      setTimeout(() => {
        if (listed()) {
          say("still-open");
          desktop.closeBrowserWindow(windowId);
        }
      }, settleMs);
    }
  });

  // Sized rather than stretched between insets: see
  // guard-webview-routed-link.js. `window` is set before the element enters
  // the document, when it asks for its page.
  const draw = (id) => {
    const view = document.createElement("webview");
    view.style.position = "absolute";
    view.style.insetBlockStart = stripHeight;
    view.style.insetInline = "0";
    view.style.inlineSize = "100%";
    view.style.blockSize = `calc(100% - ${stripHeight})`;
    view.style.border = "0";
    view.setAttribute("window", id);
    view.addEventListener("domicile-page-change", () => {
      if (!closing && view.url.endsWith("#pressed")) {
        closing = true;
        say("closing");
        desktop.closeBrowserWindow(id);
      }
    });
    document.body.append(view);
  };

  // The first list is empty, so this opens the window; the next one holds it.
  let opened = false;
  desktop.addEventListener("browserwindowschanged", () => {
    const windows = desktop.browserWindows ?? [];
    if (!opened) {
      opened = true;
      if (windows.length === 0) {
        desktop.openBrowserWindow(src);
      }
    }
    if (windowId === undefined && windows.length > 0) {
      windowId = windows[0].id;
      draw(windowId);
    } else if (windowId !== undefined && !listed()) {
      say("window-closed");
    }
  });

  say("shell-loaded");
};
