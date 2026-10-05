// The shell for guard-webview-survives-load-shell.sh. The guard loads it
// twice: `domicile load-shell` loads this module over itself, reloading the
// page. Both loads draw the desk's browser windows.
//
// - `?mode=window` is the claim: the page is a desk browser window, opened with
//   openBrowserWindow and drawn with `<webview window>`. The browser owns it,
//   so it survives this document.
// - `?mode=own` is the control: the same page in a `<webview src>`, owned by
//   this document, so the reload must load it again.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded           this module ran: once per load
//   GUARD drawn id=…             a browser window from the desk's list was
//                                drawn in a <webview window>
//   GUARD shown url=…            a <webview> says which page it is showing
//
// The page logs `page-loaded` and `tick` itself; see
// guard-webview-survives-load-shell-server.py.
//
// Everything is inside `Shell`, which Domicile's document calls once the module
// loads.

export const Shell = () => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  /**
   * Reads a required query parameter. A default would make a misinvoked guard
   * measure the wrong thing.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(
        `guard-webview-survives-load-shell: ?${name}= is required`,
      );
    } else {
      return value;
    }
  };

  const host = navigator.domicile;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-survives-load-shell: navigator.domicile is absent, so" +
        " this document was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const src = required(parameters, "src");
  const own = required(parameters, "mode") === "own";

  // A full-page <webview> that logs what it shows. `window` is set before the
  // element enters the document, when it asks for its page. `src` is set
  // after, because the element needs its frame first.
  const draw = (attributes) => {
    const view = document.createElement("webview");
    view.style.position = "absolute";
    view.style.inset = "0";
    view.style.inlineSize = "100%";
    view.style.blockSize = "100%";
    view.style.border = "0";
    view.addEventListener("domicile-page-change", () => {
      say(`shown url=${view.url}`);
    });
    if (attributes.window !== undefined) {
      view.setAttribute("window", attributes.window);
    }
    document.body.append(view);
    if (attributes.src !== undefined) {
      view.setAttribute("src", attributes.src);
    }
  };

  document.body.style.margin = "0";

  if (own) {
    draw({ src });
  } else {
    // The first load opens the window and the second finds it. The list tells
    // the loads apart: empty means no window yet, otherwise it holds the
    // window the last load opened, which this load must draw, not reopen.
    let listed = false;
    const drawn = new Set();
    host.addEventListener("browserwindowschanged", () => {
      const windows = host.browserWindows ?? [];
      if (!listed) {
        listed = true;
        if (windows.length === 0) {
          host.openBrowserWindow(src);
        }
      }
      for (const window of windows) {
        if (!drawn.has(window.id)) {
          drawn.add(window.id);
          draw({ window: window.id });
          say(`drawn id=${window.id}`);
        }
      }
    });
  }

  say("shell-loaded");
};
