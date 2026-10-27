// The shell for guard-webview-moved.sh. It opens one browser window, draws it
// in a <webview window> inside a box, then moves the box to the other end of
// the document and back, as React does when it reorders a keyed list.
//
// - `?moves=N` is how many times the box moves: 3 for the claim, 0 for the
//   control.
// - `?settle=` is the ms between attaching and the first move, between moves,
//   and after the last one.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded   this module ran
//   GUARD attached       the <webview> says which page it shows, so the window
//                        is attached
//   GUARD moved          the box moved
//   GUARD settled        `?settle=` ms after the last move, or after attached
//                        with no moves
//
// The page logs its visibility itself; see guard-webview-hidden-server.py.
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
      throw new Error(`guard-webview-moved: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-moved: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const src = required(parameters, "src");
  const moves = Number(required(parameters, "moves"));
  const settle = Number(required(parameters, "settle"));

  document.body.style.margin = "0";
  // The box moves past this sibling and back, so each move is a removal and
  // an insertion, as `insertBefore` does for a node already in the document.
  const other = document.createElement("div");
  document.body.append(other);
  const box = document.createElement("div");
  box.style.position = "absolute";
  box.style.inset = "0";
  document.body.append(box);

  // Moves the box `left` more times, `settle` ms apart, then says settled.
  const move = (left) => {
    setTimeout(() => {
      if (left === 0) {
        say("settled");
      } else {
        if (box.nextSibling === null) {
          document.body.insertBefore(box, other);
        } else {
          document.body.append(box);
        }
        say("moved");
        move(left - 1);
      }
    }, settle);
  };

  // A full-size <webview> for window `id`. `window` is set before the element
  // enters the document, when it asks for its page.
  const draw = (id) => {
    const view = document.createElement("webview");
    view.style.inlineSize = "100%";
    view.style.blockSize = "100%";
    view.style.border = "0";
    view.setAttribute("window", id);
    let attached = false;
    view.addEventListener("domicile-page-change", () => {
      if (!attached) {
        attached = true;
        say("attached");
        move(moves);
      }
    });
    box.append(view);
  };

  // The first list is empty, so this opens the window; the next one holds it.
  let listed = false;
  let drawn = false;
  host.addEventListener("browserwindowschanged", () => {
    const windows = host.browserWindows ?? [];
    if (!listed) {
      listed = true;
      if (windows.length === 0) {
        host.openBrowserWindow(src);
      }
    }
    if (windows.length > 0 && !drawn) {
      drawn = true;
      draw(windows[0].id);
    }
  });

  say("shell-loaded");
};
