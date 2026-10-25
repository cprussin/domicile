// The shell module guard-webview-print.sh loads: one browser window filling
// the page. The window's page is guard-webview-print-server.py's.
//
// Once the page has loaded, it prints it with `print()`, as manganese does on
// Ctrl+Shift+P. With `?print=0`, the control, it never does.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded                 this module ran
//   GUARD printing                     it called print() on the view
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
      throw new Error(`guard-webview-print: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-webview-print: no desktop was handed to Shell, so this" +
        " document was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const src = required(parameters, "src");
  const prints = required(parameters, "print") === "1";

  // Time for the page's first frame after it loads. print() renders the page,
  // and a page that has not drawn may still be laying out.
  const settleMs = 1000;

  document.body.style.margin = "0";

  // Sized rather than stretched between insets: see
  // guard-webview-routed-link.js. `window` is set before the element enters
  // the document, when it asks for its page.
  const draw = (id) => {
    const view = document.createElement("webview");
    view.style.position = "absolute";
    view.style.inset = "0";
    view.style.inlineSize = "100%";
    view.style.blockSize = "100%";
    view.style.border = "0";
    view.setAttribute("window", id);
    let asked = false;
    const printOnceLoaded = () => {
      if (prints && !asked && !view.loading && view.url.endsWith("/page")) {
        asked = true;
        setTimeout(() => {
          say("printing");
          view.print();
        }, settleMs);
      }
    };
    view.addEventListener("domicile-loading-change", printOnceLoaded);
    // A page that finished loading before the element attached sends no
    // loading change: `loading` starts false and stays so. Its URL still
    // arrives, as a page change.
    view.addEventListener("domicile-page-change", printOnceLoaded);
    document.body.append(view);
  };

  // The first list is empty, so this opens the window; the next one holds it.
  let opened = false;
  let windowId;
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
    }
  });

  say("shell-loaded");
};
