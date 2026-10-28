// The shell for guard-webview-paused.sh. It draws one browser window in a
// full-size <webview>, then plays two animations on the window's box, as
// manganese does:
//
// - slide: in from 80% off the left edge, as in a workspace switch
// - shrink: to 30% of its size, as a window sent to another workspace
//
// It plays both while the page runs, then narrows the box by a pixel, which
// makes the page open a `confirm()` (guard-webview-paused-server.py). It claims
// the dialog, never answers it, and plays both again.
//
// Each animation is a CSS one, run on the compositor thread. The shell counts
// its own frames meanwhile with requestAnimationFrame, which runs only as fast
// as the shell's frames are shown.
//
// `?ms=` is each animation's length, and the wait before the first.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded                  this module ran
//   GUARD played <name> frames=<n>      an animation ended after n frames;
//                                       <name> is running-slide,
//                                       running-shrink, paused-slide or
//                                       paused-shrink
//   GUARD dialog-claimed                the page's confirm() reached the shell
//   GUARD done                          every animation played
//   GUARD threw <error>                 an animation threw
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
      throw new Error(`guard-webview-paused: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-paused: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const src = required(parameters, "src");
  const ms = Number(required(parameters, "ms"));

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  const box = document.createElement("div");
  box.style.position = "absolute";
  box.style.inset = "0";
  document.body.append(box);

  const KEYFRAMES = {
    shrink: [{ transform: "scale(1)" }, { transform: "scale(0.3)" }],
    slide: [{ transform: "translateX(-80%)" }, { transform: "translateX(0)" }],
  };

  // Plays `motion` on the box, counting the shell's frames until it ends.
  const play = (state, motion) =>
    new Promise((done) => {
      let frames = 0;
      let playing = true;
      const count = () => {
        frames += 1;
        if (playing) {
          requestAnimationFrame(count);
        }
      };
      requestAnimationFrame(count);
      box.animate(KEYFRAMES[motion], { duration: ms }).finished.then(() => {
        playing = false;
        say(`played ${state}-${motion} frames=${frames}`);
        done();
      });
    });

  const playBoth = async (state) => {
    await play(state, "slide");
    await play(state, "shrink");
  };

  // A full-size <webview> for window `id`. `window` is set before the element
  // enters the document, when it asks for its page.
  const draw = (id) => {
    const view = document.createElement("webview");
    view.style.inlineSize = "100%";
    view.style.blockSize = "100%";
    view.style.border = "0";
    view.setAttribute("window", id);
    view.addEventListener("domicile-dialog", (event) => {
      // Claimed and never answered, so the page stays paused.
      event.preventDefault();
      say("dialog-claimed");
      playBoth("paused")
        .then(() => {
          say("done");
        })
        .catch((error) => {
          say(`threw ${error}`);
        });
    });
    let attached = false;
    view.addEventListener("domicile-page-change", () => {
      if (!attached) {
        attached = true;
        // After the page's first frames, so the first animation does not
        // count its load.
        setTimeout(() => {
          playBoth("running")
            .then(() => {
              box.style.inset = "0 1px 0 0";
            })
            .catch((error) => {
              say(`threw ${error}`);
            });
        }, ms);
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
