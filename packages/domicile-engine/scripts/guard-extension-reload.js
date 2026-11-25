// The shell for guard-extension-reload.sh. It opens a browser window at
// `?first=` and one at `?second=`, which the engine puts in two profiles, draws
// each in a <webview window>, and reloads both every second: a content script
// runs only in pages loaded after its extension loads.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded     this module ran
//   GUARD profile=ID       a window's profile, as the list says
//
// The pages log which edit of the extension ran in them; see
// guard-extension-reload-server.py.
//
// Everything is inside `HostShell`, which Domicile's document calls once the
// module loads.

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
      throw new Error(`guard-extension-reload: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const RELOAD_EVERY_MS = 1000;

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-extension-reload: no desktop was handed to Shell, so this " +
        "document was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const first = required(parameters, "first");
  const second = required(parameters, "second");

  // A <webview> for window `id`, in its own half of the desk so both pages
  // show. `window` is set before the element enters the document, when it asks
  // for its page.
  const draw = (id, index) => {
    const view = document.createElement("webview");
    view.style.position = "absolute";
    view.style.top = "0";
    view.style.left = `${index * 50}%`;
    view.style.width = "50%";
    view.style.height = "100%";
    view.style.border = "0";
    view.setAttribute("window", id);
    // The first report is the window's first page showing.
    let reloading = false;
    view.addEventListener("domicile-page-change", () => {
      if (!reloading) {
        reloading = true;
        setInterval(() => {
          view.reload();
        }, RELOAD_EVERY_MS);
      }
    });
    document.body.append(view);
  };

  // The first list is empty, so this opens the windows; later ones hold them.
  let opened = false;
  const drawn = new Set();
  host.addEventListener("browserwindowschanged", () => {
    if (!opened) {
      opened = true;
      host.openBrowserWindow(first);
      host.openBrowserWindow(second);
    }
    for (const window of host.browserWindows ?? []) {
      if (!drawn.has(window.id)) {
        draw(window.id, drawn.size);
        drawn.add(window.id);
        say(`profile=${window.profile}`);
      }
    }
  });

  say("shell-loaded");
};
