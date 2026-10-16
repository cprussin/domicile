// The shell for guard-webview-crash.sh. It shows one page in a full-size
// <webview src> over a magenta body, waits for it to load, crashes its
// renderer, then reloads it once the page is heard gone.
//
// Not on a timer from the crash: a crashing renderer prints its symbolized
// stack before it dies, which took 15s on crux, and a reload sent while it
// still lives goes to the dying process and is lost with it.
//
// - `?crash=1` is the claim: the view navigates to `chrome://crash`, which
//   crashes the renderer of the page it shows.
// - `?crash=0` is the control: the view is left alone.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded                   this module ran
//   GUARD loaded                         the page finished loading
//   GUARD crashing | GUARD leaving-it    the step, `?settle=` ms after loaded
//   GUARD render-process gone=R exit=N   each `domicile-render-process-change`,
//                                        with `renderProcessGone` (`none` for
//                                        "") and `renderProcessExitCode`
//   GUARD reloading                      reload(), 2 × `?settle=` ms after the
//                                        page is heard gone (the control: after
//                                        its step)
//
// The page logs its own loads; see guard-webview-crash-server.py.
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
      throw new Error(`guard-webview-crash: ?${name}= is required`);
    } else {
      return value;
    }
  };

  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-webview-crash: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const src = required(parameters, "src");
  const crash = required(parameters, "crash") === "1";
  const settle = Number(required(parameters, "settle"));

  // Magenta, so a view that draws nothing reads as the shell's color, the
  // page's green as the page, and Chromium's sad frame as gray.
  document.body.style.margin = "0";
  document.body.style.background = "#ff00ff";

  const view = document.createElement("webview");
  view.style.position = "absolute";
  view.style.inset = "0";
  view.style.inlineSize = "100%";
  view.style.blockSize = "100%";
  view.style.border = "0";

  const reload = () => {
    say("reloading");
    view.reload();
  };

  // The guard reads the dead view's pixel in the first `settle` ms.
  let reloading = false;
  view.addEventListener("domicile-render-process-change", () => {
    const gone =
      view.renderProcessGone === "" ? "none" : view.renderProcessGone;
    say(`render-process gone=${gone} exit=${view.renderProcessExitCode}`);
    if (crash && gone !== "none" && !reloading) {
      reloading = true;
      setTimeout(reload, 2 * settle);
    }
  });

  const step = () => {
    if (crash) {
      say("crashing");
      view.src = "chrome://crash";
    } else {
      say("leaving-it");
      setTimeout(reload, 2 * settle);
    }
  };

  let loaded = false;
  view.addEventListener("domicile-loading-change", () => {
    if (!loaded && !view.loading && view.url === src) {
      loaded = true;
      say("loaded");
      setTimeout(step, settle);
    }
  });

  view.src = src;
  document.body.append(view);
  say("shell-loaded");
};
