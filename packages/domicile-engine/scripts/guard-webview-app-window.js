// The shell module guard-webview-app-window.sh loads. It draws every browser
// window the desk lists in a `<webview window>`, and logs each window's
// address and `isApp` as they change. The guard opens the subject and the
// sentinel through the engine's command socket, as `domicile open --app` does.
// This module opens `<site>/launched` itself, with `openAppWindow` when the
// address's `app` is `true` and `openBrowserWindow` otherwise (the control).
//
// It must be a domicile:// document: the browser binds WebViewGuestHost only
// for the shell's origin.
//
// Console output, which the engine writes to its log:
//
//   GUARD shell-loaded                  this module ran
//   GUARD window id=… app=… url=…       a listed window, with its `isApp`
//
// The engine's document calls `HostShell` once the module loads.

export const HostShell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  /**
   * A <webview window> with an explicit size: a replaced element with `auto`
   * size takes its intrinsic 300x150. `window` is set before attaching, since
   * the element reads it once, on asking for a guest.
   */
  const draw = (id) => {
    const view = document.createElement("webview");
    view.style.inlineSize = "320px";
    view.style.blockSize = "200px";
    view.setAttribute("window", id);
    document.body.append(view);
  };

  // What was last logged for each window id, so each change is logged once.
  const logged = new Map();
  desktop.addEventListener("browserwindowschanged", () => {
    for (const window of desktop.browserWindows ?? []) {
      const line = `window id=${window.id} app=${window.isApp} url=${window.url}`;
      if (!logged.has(window.id)) {
        draw(window.id);
      }
      if (logged.get(window.id) !== line) {
        logged.set(window.id, line);
        say(line);
      }
    }
  });

  say("shell-loaded");

  const query = new URLSearchParams(location.search);
  const launched = `${query.get("site")}/launched`;
  if (query.get("app") === "true") {
    desktop.openAppWindow(launched);
  } else {
    desktop.openBrowserWindow(launched);
  }
};
