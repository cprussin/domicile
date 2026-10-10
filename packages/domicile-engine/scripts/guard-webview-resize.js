// Shell module for guard-webview-resize.sh: one browser window under a strip
// of shell UI. A press on the strip resizes the window's <webview> many times,
// as a drag on a window's border does, and ends at a known size.
//
// - `?mode=burst` is the claim: the resizes run.
// - `?mode=still` is the control: a press on the strip changes nothing, so the
//   same readings show what a browser window that was never resized gives.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded                   this module ran
//   GUARD drawn id=…                     the browser window was drawn in a
//                                        <webview window>
//   GUARD burst-started                  a press on the strip started the
//                                        resizes
//   GUARD resized width=… height=…       the resizes are over, and the
//                                        element's box was set to this size
//                                        in CSS pixels
//
// The page in the window logs its own lines; see
// guard-webview-resize-server.py.
//
// The document Domicile writes calls `Shell` once the module loads.

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
      throw new Error(`guard-webview-resize: ?${name}= is required`);
    } else {
      return value;
    }
  };

  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-webview-resize: no desktop was handed to Shell, so this" +
        " document was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const src = required(parameters, "src");
  const stripHeight = Number(required(parameters, "strip"));
  const steps = Number(required(parameters, "steps"));
  const burst = required(parameters, "mode") === "burst";

  const strip = document.createElement("div");
  strip.style.position = "absolute";
  strip.style.insetBlockStart = "0";
  strip.style.insetInline = "0";
  strip.style.blockSize = `${stripHeight}px`;
  strip.style.background = "#204060";

  // Sized in pixels, so every step is a new box. A <webview> is a replaced
  // element, so it would otherwise take its intrinsic 300x150.
  const view = document.createElement("webview");
  view.style.position = "absolute";
  view.style.insetBlockStart = `${stripHeight}px`;
  view.style.insetInlineStart = "0";
  view.style.border = "0";

  const fullWidth = () => document.documentElement.clientWidth;
  const fullHeight = () => document.documentElement.clientHeight - stripHeight;

  const size = (width, height) => {
    view.style.inlineSize = `${width}px`;
    view.style.blockSize = `${height}px`;
  };

  /**
   * The box for step `step`: it swings between a quarter and all of the room,
   * width and height out of phase, so both grow and shrink.
   */
  const boxAt = (step) => {
    const swing = (phase) => 0.625 + 0.375 * Math.sin(step / 7 + phase);
    return {
      height: Math.round(fullHeight() * swing(Math.PI / 2)),
      width: Math.round(fullWidth() * swing(0)),
    };
  };

  /**
   * Resizes the element `steps` times, then returns it to the full room.
   *
   * Two boxes per frame, the first laid out at once: a drag delivers several
   * pointer moves per frame, and each move lays the window out again.
   */
  const resize = () => {
    let step = 0;
    const frame = () => {
      if (step < steps) {
        const first = boxAt(step);
        size(first.width, first.height);
        view.getBoundingClientRect();
        const second = boxAt(step + 1);
        size(second.width, second.height);
        step += 2;
        requestAnimationFrame(frame);
      } else {
        size(fullWidth(), fullHeight());
        say(`resized width=${fullWidth()} height=${fullHeight()}`);
      }
    };
    requestAnimationFrame(frame);
  };

  strip.addEventListener("mousedown", () => {
    if (burst) {
      say("burst-started");
      resize();
    } else {
      say(`resized width=${fullWidth()} height=${fullHeight()}`);
    }
  });

  document.body.style.margin = "0";
  document.body.append(strip);
  size(fullWidth(), fullHeight());

  // Opens one browser window and draws it. `window` is set before the element
  // enters the document, when it asks for its page.
  let opened = false;
  desktop.addEventListener("browserwindowschanged", () => {
    const windows = desktop.browserWindows ?? [];
    if (!opened) {
      opened = true;
      desktop.openBrowserWindow(src);
    }
    if (windows.length > 0 && !view.isConnected) {
      view.setAttribute("window", windows[0].id);
      document.body.append(view);
      say(`drawn id=${windows[0].id}`);
    }
  });

  say("shell-loaded");
};
