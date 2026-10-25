// The shell module guard-webview-private.sh loads: a page that sets a cookie
// on one side (private or not), readers on both sides, and a browser window
// the shell opens on the setter's side. Once they have reported, every
// private page closes, and a new private reader checks the cookie went with
// them.
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
//   GUARD closed-private                every private page was closed
//
// The pages report `GUARD set-loaded` and `GUARD read as=… cookie=…` to the
// page server's log, since a private page's console is not logged; see
// guard-webview-private-server.py. Readers are `normal`, `private`, `window`
// and `after`.
//
// The engine's document calls `HostShell` once the module loads.

// Time for the engine to end private browsing after its last page closes:
// ProfileDestroyer waits up to a second for the pages' renderers.
const END_MS = 3000;

export const HostShell = (_root, desktop) => {
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

  /** Resolves once `made`'s page has reported to the server. */
  const reported = (made) =>
    new Promise((resolve) => {
      const check = () => {
        if (made.url.endsWith("#reported")) {
          made.removeEventListener("domicile-page-change", check);
          resolve();
        }
      };
      made.addEventListener("domicile-page-change", check);
      check();
    });

  const drawn = new Set();
  let windowShown;
  const shownWindow = new Promise((resolve) => {
    windowShown = resolve;
  });
  desktop.addEventListener("browserwindowschanged", () => {
    for (const window of desktop.browserWindows ?? []) {
      if (!drawn.has(window.id)) {
        drawn.add(window.id);
        say(`window id=${window.id} private=${window.isPrivate}`);
        const shown = view({ window: window.id });
        document.body.append(shown);
        windowShown({ id: window.id, reported: reported(shown), shown });
      }
    }
  });

  /**
   * Closes every private page once each page has reported, then reads the
   * cookie from a new private page after the engine has had time to end
   * private browsing.
   */
  const closePrivate = async (setter, privateReader) => {
    const window = await shownWindow;
    await Promise.all([
      reported(setter),
      reported(privateReader),
      window.reported,
    ]);
    setter.remove();
    privateReader.remove();
    window.shown.remove();
    desktop.closeBrowserWindow(window.id);
    say("closed-private");
    await new Promise((resolve) => {
      setTimeout(resolve, END_MS);
    });
    load(view({ private: "" }), `${site}/read?as=after`);
  };

  // Readers start once the setter's page has committed. The cookie comes in
  // its response headers, so it is stored by then.
  const setter = view(setterSide);
  let started = false;
  setter.addEventListener("domicile-page-change", () => {
    if (!started) {
      started = true;
      load(view({}), `${site}/read?as=normal`);
      const privateReader = view({ private: "" });
      load(privateReader, `${site}/read?as=private`);
      closePrivate(setter, privateReader).catch((error) => {
        say(`close-private-failed ${error}`);
      });
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
