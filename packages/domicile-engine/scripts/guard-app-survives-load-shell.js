// The shell for guard-app-survives-load-shell.sh. It draws the desk's first
// window in one `<app>` at the top left of the page.
//
// The guard copies this file to `load-1.js` and `load-2.js` and loads them in
// turn, the second with `domicile load-shell`. The name sets the box: 40% of
// the page on each side for load 1, 80% for load 2. A reload at a new box size
// is what froze a client: the new `<app>` adopted the old surface id at the new
// size.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded load=N   this module ran
//   GUARD drawn app=<id> load=N an `<app>` for the first window is on the page
//
// Everything is inside `Shell`, which Domicile's document calls once the module
// loads.

export const Shell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-app-survives-load-shell: no desktop was handed to Shell, so" +
        " this document was not served by the forked engine",
    );
  }

  const named = /\/load-([12])\.js$/.exec(import.meta.url);
  if (named === null) {
    throw new Error(
      `guard-app-survives-load-shell: loaded as ${import.meta.url}, not as` +
        " load-1.js or load-2.js, so it cannot tell which box to draw",
    );
  }
  const load = Number(named[1]);
  const share = `${40 * load}%`;

  // Not any color the client draws, so the probe cannot find the page.
  document.body.style.background = "#202020";

  let drawn = false;
  const draw = () => {
    const first = desktop.windows[0];
    if (!drawn && first !== undefined) {
      drawn = true;
      const app = document.createElement("app");
      app.setAttribute("app-id", first.appId);
      Object.assign(app.style, {
        blockSize: share,
        inlineSize: share,
        insetBlockStart: "0",
        insetInlineStart: "0",
        margin: "0",
        position: "fixed",
      });
      document.body.append(app);
      say(`drawn app=${first.appId} load=${load}`);
    }
  };
  desktop.addEventListener("windowschanged", draw);
  draw();

  say(`shell-loaded load=${load}`);
};
