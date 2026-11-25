// The shell for guard-app-3d-transform.sh. It draws the desk's first window
// in a 640 by 480 `<app>` with `transform: perspective(1000px)
// translateZ(-1000px)`, which draws it at half its size. It logs to the
// console, which the engine writes to its log:
//
//   GUARD drawn app=<id> width=<px> transform=<transform>
//                     the `<app>`, and its untransformed width in device pixels
//
// `?control=1` draws the `<app>` with no transform, so the window covers its
// whole width.

const CONTROL = new URL(location.href).searchParams.get("control") === "1";

export const HostShell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-app-3d-transform: no desktop was handed to Shell, so this" +
        " document was not served by the forked engine",
    );
  }

  // Not the client's color, so the probe cannot find the page.
  document.body.style.background = "#202020";

  let drawn = false;
  const windows = () => {
    const first = desktop.windows[0];
    if (drawn || first === undefined) {
      return;
    }
    drawn = true;
    const app = document.createElement("app");
    app.setAttribute("app-id", first.appId);
    Object.assign(app.style, {
      blockSize: "480px",
      inlineSize: "640px",
      insetBlockStart: "0",
      insetInlineStart: "0",
      margin: "0",
      position: "fixed",
      transform: CONTROL ? "none" : "perspective(1000px) translateZ(-1000px)",
      transformOrigin: "0 0",
    });
    document.body.append(app);
    const width = Math.round(app.offsetWidth * devicePixelRatio);
    say(
      `drawn app=${first.appId} width=${width} transform=${getComputedStyle(app).transform}`,
    );
  };
  desktop.addEventListener("windowschanged", windows);
  windows();
};
