// The shell guard-scrolling-bubble.sh drives. It draws each window in an
// `<app>` at its own size: a toplevel at the page's top left, a popup at its
// place over its parent there.
//
// It calls `syncFrames()` and sets each `<app frame>` in the same render as
// the move, as a shell that renders frames does. With `?late=1`, the guard's
// control, it places each window where the move before put it: each frame
// shown with the move a step behind it.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded late=<0|1>     this module ran
//   GUARD drawn app=<id>              an `<app>` for a window is on the page
//   GUARD synced app=<id> frame=<n>   the first synced frame named for a
//                                     window
//
// Everything is inside `Shell`, which Domicile's document calls once the module
// loads.

export const Shell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-scrolling-bubble: no desktop was handed to Shell, so this" +
        " document was not served by the forked engine",
    );
  }

  const late = new URLSearchParams(location.search).get("late");
  if (late !== "0" && late !== "1") {
    throw new Error(
      `guard-scrolling-bubble: ?late= is ${late}, not 0 or 1, so it cannot` +
        " tell whether to place moves late",
    );
  }
  desktop.syncFrames();

  // Not any color the client draws, so the cast reader cannot find the page.
  document.body.style.background = "#202020";

  const apps = new Map();
  const synced = new Set();
  // Per window, the place its newest move put it and the one before, each as
  // `[left, top, width, height]`.
  const places = new Map();
  const placeOf = (listed) => {
    const place = [
      listed.x ?? 0,
      listed.y ?? 0,
      listed.width ?? 0,
      listed.height ?? 0,
    ];
    const known = places.get(listed.appId);
    if (known === undefined) {
      places.set(listed.appId, { before: place, now: place });
    } else if (known.now.join() !== place.join()) {
      places.set(listed.appId, { before: known.now, now: place });
    }
    const { before, now } = places.get(listed.appId);
    return late === "1" ? before : now;
  };
  const draw = () => {
    for (const listed of desktop.windows) {
      if (!apps.has(listed.appId)) {
        const app = document.createElement("app");
        app.setAttribute("app-id", listed.appId);
        document.body.append(app);
        apps.set(listed.appId, app);
        say(`drawn app=${listed.appId}`);
      }
      // A toplevel has no place and sits at the top left, so a popup's place
      // over its parent is its place on the page.
      const [left, top, width, height] = placeOf(listed);
      Object.assign(apps.get(listed.appId).style, {
        blockSize: `${height}px`,
        inlineSize: `${width}px`,
        insetBlockStart: `${top}px`,
        insetInlineStart: `${left}px`,
        margin: "0",
        position: "fixed",
      });
      apps.get(listed.appId).setAttribute("frame", String(listed.frame));
      if (listed.frame > 0 && !synced.has(listed.appId)) {
        synced.add(listed.appId);
        say(`synced app=${listed.appId} frame=${listed.frame}`);
      }
    }
  };
  desktop.addEventListener("windowschanged", draw);
  draw();

  say(`shell-loaded late=${late}`);
};
