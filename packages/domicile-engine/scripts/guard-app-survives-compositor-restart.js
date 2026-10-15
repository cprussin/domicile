// The shell for guard-app-survives-compositor-restart.sh. It draws the desk's
// first window in one `<app>`, keeps that `<app>` across the restart, and
// watches a directory with raw system calls.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded                this module ran
//   GUARD drawn app=<id>              an `<app>` for the first window
//   GUARD appeared app=<id>           a window the shell had not seen
//   GUARD closed app=<id>             a window closed
//   GUARD system <line>               an answer to a system call
//   GUARD rewatch id=<n>              it watched again, as the SDK does
//   GUARD replaced                    `compositorreplaced` fired
//
// Raw calls rather than the SDK's `system`, which this page cannot import:
// the guard checks what the engine does, and the SDK's own part is unit
// tested in chrome-sdk's system.test.ts.

// Must match WATCHED in the guard.
const WATCHED = "/tmp/domicile-app-survives-compositor-restart-watched";

export const Shell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-app-survives-compositor-restart: no desktop was handed to Shell," +
        " so this document was not served by the forked engine",
    );
  }

  // Not any color the client draws, so the probe cannot find the page.
  document.body.style.background = "#202020";

  // The first window's `<app>` stays for the whole run: the next compositor's
  // first window has the same id, and the `<app>` embeds it again.
  let drawn = false;
  const seen = new Set();
  const windows = () => {
    for (const window of desktop.windows) {
      if (!seen.has(window.appId)) {
        seen.add(window.appId);
        say(`appeared app=${window.appId}`);
      }
    }
    for (const appId of [...seen]) {
      if (!desktop.windows.some((window) => window.appId === appId)) {
        seen.delete(appId);
        say(`closed app=${appId}`);
      }
    }
    const first = desktop.windows[0];
    if (!drawn && first !== undefined) {
      drawn = true;
      const app = document.createElement("app");
      app.setAttribute("app-id", first.appId);
      Object.assign(app.style, {
        blockSize: "60%",
        inlineSize: "60%",
        insetBlockStart: "0",
        insetInlineStart: "0",
        margin: "0",
        position: "fixed",
      });
      document.body.append(app);
      say(`drawn app=${first.appId}`);
    }
  };
  desktop.addEventListener("windowschanged", windows);
  windows();

  // One watch, sent again under a new id when the compositor takes it, as the
  // SDK's `listening` does.
  let next = 1;
  const watch = () => {
    const id = next;
    next += 1;
    desktop.callSystem(id, JSON.stringify({ call: "watch", path: WATCHED }));
    return id;
  };
  let watching = watch();
  desktop.addEventListener("system", (event) => {
    say(`system ${event.data}`);
    const answer = JSON.parse(event.data);
    const ended = answer.type === "system_end" ? answer.end : answer.reply;
    if (
      answer.id === watching &&
      ended?.kind === "failed" &&
      ended.error.kind === "compositor_gone"
    ) {
      watching = watch();
      say(`rewatch id=${watching}`);
    }
  });

  desktop.addEventListener("compositorreplaced", () => {
    say("replaced");
  });

  say("shell-loaded");
};
