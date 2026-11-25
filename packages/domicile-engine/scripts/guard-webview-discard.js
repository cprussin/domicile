// The shell for guard-webview-discard.sh. `?mode=manual` unloads one browser
// window by hand, and hides another whose <webview> stays mounted.
// `?mode=automatic` leaves three unmounted for the engine to unload or not, and
// `?mode=handled` does too, but listens for the shortage itself.
//
// - `?discard=1` is the claim and `?discard=0` the control, whose shell never
//   asks (manual; automatic's control is the engine's thresholds).
// - `?src=` is the page server's address.
// - `?settle=` is the ms between steps, so each has landed before the next.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded                this module ran
//   GUARD list name=… discarded=…     a window's isDiscarded changed
//   GUARD asked-attached              asked to unload a window a <webview>
//                                     shows (manual)
//   GUARD unmounted                   no <webview> shows the windows
//   GUARD asked                       asked to unload the subject, an
//                                     extension's popup window and a DevTools
//                                     window, or in the control only came this
//                                     far (manual)
//   GUARD quiet                       `settle` ms later
//   GUARD remounting                  `settle` ms later, a <webview> shows the
//                                     subject again (manual)
//   GUARD hidden                      the mounted window is not rendered
//                                     (manual)
//   GUARD asked-hidden                asked to unload it, or in the control
//                                     only came this far (manual)
//   GUARD showing-hidden              `settle` ms later, it is rendered again
//                                     (manual)
//   GUARD shown-hidden                `settle` ms after that (manual)
//   GUARD short count=…               the shortage was heard, with how many
//                                     windows (handled)
//   GUARD done                        the last step, `settle` ms after it
//
// The pages log too (guard-webview-discard-server.py), and the extension
// (guard-webview-discard-extension/popup.js).
//
// Everything is inside `HostShell`, which Domicile's document calls once the module
// loads.

export const HostShell = (_root, desktop) => {
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
      throw new Error(`guard-webview-discard: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-discard: no desktop was handed to Shell, so this" +
        " document was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const mode = required(parameters, "mode");
  const discard = required(parameters, "discard") === "1";
  const settle = Number(required(parameters, "settle"));
  const expected = required(parameters, "expect");
  const src = required(parameters, "src");

  // Window names in open order, which is the list's. The DevTools window comes
  // after them.
  const names =
    mode === "manual"
      ? ["active", "subject-1", "kept"]
      : ["active", "plain", "typed"];
  const SUBJECT = 1;
  const KEPT = 2;

  document.body.style.margin = "0";

  const settled = () =>
    new Promise((resolve) => {
      setTimeout(resolve, settle);
    });

  /**
   * A <webview> in the column at `index` with `attribute` set, calling `shown`
   * with each page's address. `window` is set before the element enters the
   * document, when it asks for its page; `src` after, when it has a frame.
   */
  const view = (index, attribute, value, shown = () => undefined) => {
    const element = document.createElement("webview");
    element.style.position = "absolute";
    element.style.insetInlineStart = `${index * 25}%`;
    element.style.inlineSize = "25%";
    element.style.blockSize = "100%";
    element.style.border = "0";
    element.addEventListener("domicile-page-change", () => {
      shown(element.url);
    });
    if (attribute === "window") {
      element.setAttribute(attribute, value);
      document.body.append(element);
    } else {
      document.body.append(element);
      element.setAttribute(attribute, value);
    }
    return element;
  };

  /** Resolves once each of `addresses` was shown in its window. */
  const mountAll = (ids) =>
    Promise.all(
      names.map(
        (name, index) =>
          new Promise((resolve) => {
            const element = view(index, "window", ids[index], (url) => {
              if (url === `${src}?${name}`) {
                resolve(element);
              }
            });
          }),
      ),
    );

  /** Resolves with the fixture's popup address, once it is in the tray. */
  const extensionPage = () =>
    new Promise((resolve) => {
      const look = () => {
        const row = (host.extensions ?? []).find(
          (extension) => extension.id === expected,
        );
        if (row !== undefined && row.popup !== null) {
          resolve(row.popup);
        }
      };
      host.addEventListener("extensionschanged", look);
      look();
    });

  /** Resolves once the list has `count` windows, which it logs the state of. */
  const opened = (count) =>
    new Promise((resolve) => {
      const was = new Map();
      const look = () => {
        const windows = (host.browserWindows ?? []).filter(
          (window) => window.popupWindow === null,
        );
        windows.forEach((window, index) => {
          if (was.get(window.id) !== window.isDiscarded) {
            was.set(window.id, window.isDiscarded);
            const name = names[index] ?? "devtools";
            say(`list name=${name} discarded=${window.isDiscarded}`);
          }
        });
        if (windows.length === count) {
          resolve(windows.map((window) => window.id));
        }
      };
      host.addEventListener("browserwindowschanged", look);
    });

  const popupWindow = () => {
    const found = host.browserWindows.find(
      (window) => window.popupWindow !== null,
    );
    if (found === undefined) {
      throw new Error("guard-webview-discard: no extension popup window");
    } else {
      return found.id;
    }
  };

  /** Shows the subject's second page, so its history has two entries. */
  const goOn = (subject) =>
    new Promise((resolve) => {
      subject.addEventListener("domicile-page-change", () => {
        if (subject.url === `${src}?subject-2`) {
          resolve();
        }
      });
      subject.src = `${src}?subject-2`;
    });

  /** Opens DevTools for `page`, and resolves with its window's id. */
  const openDevTools = (page) =>
    new Promise((resolve) => {
      host.addEventListener("browserwindowschanged", () => {
        const found = host.browserWindows.find((window) =>
          window.url.startsWith("devtools://"),
        );
        if (found !== undefined) {
          resolve(found.id);
        }
      });
      page.inspect();
    });

  const manual = async (ids, views) => {
    // A navigation while the first page still loads replaces its entry.
    await settled();
    await goOn(views[SUBJECT]);
    const devTools = await openDevTools(views[0]);
    await settled();
    view(3, "src", await extensionPage());
    await settled();
    host.discardBrowserWindow(ids[SUBJECT]);
    say("asked-attached");
    await settled();
    views[SUBJECT].remove();
    say("unmounted");
    await settled();
    if (discard) {
      host.discardBrowserWindow(ids[SUBJECT]);
      host.discardBrowserWindow(popupWindow());
      host.discardBrowserWindow(devTools);
    }
    say("asked");
    await settled();
    say("quiet");
    await settled();
    say("remounting");
    view(SUBJECT, "window", ids[SUBJECT]);
    await settled();
    views[KEPT].style.display = "none";
    say("hidden");
    await settled();
    if (discard) {
      host.discardBrowserWindow(ids[KEPT]);
    }
    say("asked-hidden");
    await settled();
    say("showing-hidden");
    views[KEPT].style.display = "";
    await settled();
    say("shown-hidden");
    say("done");
  };

  const automatic = async (_ids, views) => {
    if (mode === "handled") {
      host.addEventListener("browsermemoryshort", (event) => {
        say(`short count=${JSON.parse(event.data).length}`);
      });
    }
    await settled();
    for (const element of views) {
      element.remove();
    }
    say("unmounted");
    // The engine looks every five seconds, and unloads one page each time.
    for (let waits = 0; waits < 6; waits += 1) {
      await settled();
    }
    say("done");
  };

  const run = async () => {
    const listed = opened(names.length);
    for (const name of names) {
      host.openBrowserWindow(`${src}?${name}`);
    }
    const ids = await listed;
    const views = await mountAll(ids);
    await (mode === "manual" ? manual(ids, views) : automatic(ids, views));
  };

  // The first list is empty, and the windows are opened once it has come.
  let started = false;
  host.addEventListener("browserwindowschanged", () => {
    if (!started) {
      started = true;
      run().catch((error) => {
        say(`shell-failed ${error.message}`);
      });
    }
  });

  say("shell-loaded");
};
