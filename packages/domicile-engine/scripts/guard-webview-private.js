// The shell module guard-webview-private.sh loads: a page that sets a cookie
// on one side (private or not), readers on both sides, and a browser window
// the shell opens on the setter's side.
//
// It must be a domicile:// document: the browser binds WebViewGuestHost only
// for the shell's origin.
//
// `private=1` makes the setter a `<webview private>` and opens the window with
// `openPrivateBrowserWindow`; `private=0` (the control) uses neither.
//
// Console output, which the engine writes to its log:
//
//   GUARD shell-loaded                  this module ran
//   GUARD window id=… private=…         a browser window appeared in the list,
//                                       with its `isPrivate`
//
// The pages report `GUARD set-loaded` and `GUARD read as=… cookie=…` to the
// page server's log, since a private page's console is not logged; see
// guard-webview-private-server.py. Readers are `normal`, `private` and
// `window`.
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
      throw new Error(`guard-webview-private: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  /**
   * A <webview> with an explicit size: a replaced element with `auto` size
   * takes its intrinsic 300x150. `private` and `window` are set before
   * attaching, since the element reads them once, on asking for a guest.
   */
  const view = (attributes) => {
    const made = document.createElement("webview");
    made.style.inlineSize = "320px";
    made.style.blockSize = "200px";
    for (const [name, value] of Object.entries(attributes)) {
      made.setAttribute(name, value);
    }
    return made;
  };

  /** Appends a view, then sets `src`, which asks for a guest. */
  const load = (made, src) => {
    document.body.append(made);
    made.setAttribute("src", src);
  };

  const parameters = new URLSearchParams(location.search);
  const site = required(parameters, "site");
  const isPrivate = required(parameters, "private") === "1";
  const setterSide = isPrivate ? { private: "" } : {};

  const drawn = new Set();
  desktop.addEventListener("browserwindowschanged", () => {
    for (const window of desktop.browserWindows ?? []) {
      if (!drawn.has(window.id)) {
        drawn.add(window.id);
        say(`window id=${window.id} private=${window.isPrivate}`);
        const shown = view({ window: window.id });
        document.body.append(shown);
      }
    }
  });

  // Readers start once the setter's page has committed. The cookie comes in
  // its response headers, so it is stored by then.
  const setter = view(setterSide);
  let started = false;
  setter.addEventListener("domicile-page-change", () => {
    if (!started) {
      started = true;
      load(view({}), `${site}/read?as=normal`);
      load(view({ private: "" }), `${site}/read?as=private`);
      const windowUrl = `${site}/read?as=window`;
      if (isPrivate) {
        desktop.openPrivateBrowserWindow(windowUrl);
      } else {
        desktop.openBrowserWindow(windowUrl);
      }
    }
  });
  load(setter, `${site}/set`);

  say("shell-loaded");
};
