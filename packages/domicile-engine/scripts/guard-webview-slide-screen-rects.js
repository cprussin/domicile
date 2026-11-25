// The shell for guard-webview-slide-screen-rects.sh. It draws one browser
// window in a <webview>, then slides the window's box 200px to the right and
// leaves it there, as manganese slides windows when the workspace changes.
//
// - claim: a CSS animation of `transform`, as manganese's slides
// - control (`?mode=control`): the same slide on `left`, which no transform
//   animation holds
//
// Either way a requestAnimationFrame loop changes the shell's style every
// frame while it slides, so the shell runs a main frame every frame, as
// manganese does. A main frame is where a <webview>'s new place reaches its
// page.
//
// `?src=` is the page.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded    this module ran
//   GUARD page-shown      the <webview> reported its page
//   GUARD sliding         the slide started; also a trace TimeStamp
//   GUARD done            a second after it ended; also a trace TimeStamp
//   GUARD threw <error>   it threw
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
      throw new Error(
        `guard-webview-slide-screen-rects: ?${name}= is required`,
      );
    } else {
      return value;
    }
  };

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-slide-screen-rects: no desktop was handed to Shell, so" +
        " this document was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const src = required(parameters, "src");
  const mode = required(parameters, "mode");

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  const box = document.createElement("div");
  box.style.position = "absolute";
  box.style.inset = "0";
  document.body.append(box);

  const nextFrame = () =>
    new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });

  const wait = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  // Dirties the shell's style every frame until `until` settles.
  const runMainFrames = async (until) => {
    let running = true;
    until.then(
      () => {
        running = false;
      },
      () => {
        running = false;
      },
    );
    for (let frame = 0; running; frame += 1) {
      document.body.style.outline = `1px solid ${frame % 2 === 0 ? "red" : "blue"}`;
      await nextFrame();
    }
  };

  // Slides the box and leaves it at its new place.
  const animate = () => {
    const [property, from, to] =
      mode === "control"
        ? ["left", "0px", "200px"]
        : ["transform", "translateX(0)", "translateX(200px)"];
    box.style[property] = to;
    return box.animate([{ [property]: from }, { [property]: to }], {
      duration: 1000,
      easing: "ease-out",
    }).finished;
  };

  const slide = async () => {
    console.timeStamp("GUARD sliding");
    say("sliding");
    const slid = animate();
    await Promise.all([slid, runMainFrames(slid)]);
    await wait(1000);
    console.timeStamp("GUARD done");
    say("done");
  };

  // A full-size <webview> for window `id`. `window` is set before the element
  // enters the document, when it asks for its page.
  const draw = (id) => {
    const view = document.createElement("webview");
    view.style.inlineSize = "100%";
    view.style.blockSize = "100%";
    view.style.border = "0";
    view.setAttribute("window", id);
    let shown = false;
    view.addEventListener("domicile-page-change", () => {
      if (!shown) {
        shown = true;
        say("page-shown");
        // After the page's first frames, so its load is not counted as the
        // slide's.
        setTimeout(() => {
          slide().catch((error) => {
            say(`threw ${error}`);
          });
        }, 2000);
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
