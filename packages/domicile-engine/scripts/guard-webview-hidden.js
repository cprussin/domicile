// The shell for guard-webview-hidden.sh. It opens one browser window, draws it
// in a <webview window> inside a box, then shows the box and hides it again.
//
// - `?hide=1` is the claim: the box starts `display: none`, as manganese draws
//   a window on another workspace.
// - `?hide=0` is the control: the box is shown from the start.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded     this module ran
//   GUARD attached         the <webview> says which page it shows, so the
//                          window is attached
//   GUARD showing in WxH   the box is shown, `?settle=` ms after attached,
//                          in a viewport W by H: a <webview> outside it is
//                          occluded, which its page reads as hidden
//   GUARD hiding           the box is hidden, `?settle=` ms later
//
// The page logs its visibility itself; see guard-webview-hidden-server.py.
//
// Everything is inside `Shell`, which Domicile's document calls once the module
// loads.

export const Shell = (_root, desktop) => {
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
      throw new Error(`guard-webview-hidden: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-hidden: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const src = required(parameters, "src");
  const hide = required(parameters, "hide") === "1";
  const settle = Number(required(parameters, "settle"));

  document.body.style.margin = "0";
  const box = document.createElement("div");
  box.style.position = "absolute";
  box.style.inset = "0";
  box.style.display = hide ? "none" : "block";
  document.body.append(box);

  // Shows the box, then hides it, `settle` ms apart.
  const showThenHide = () => {
    say(`showing in a ${innerWidth}x${innerHeight} viewport`);
    box.style.display = "block";
    setTimeout(() => {
      say("hiding");
      box.style.display = "none";
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
        setTimeout(showThenHide, settle);
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
