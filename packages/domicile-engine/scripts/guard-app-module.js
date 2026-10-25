// The shell for guard-app-module.sh. It draws every browser window on the
// desk in a full-page <webview window>, which is where an app module's window
// is shown. See docs/architecture/APP-MODULES.md.
//
//   GUARD shell-loaded           this module ran
//   GUARD drawn id=…             a browser window was drawn
//
// The app logs its own lines; see guard-app-module-app/app.js.

export const HostShell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const draw = (id) => {
    const view = document.createElement("webview");
    view.style.position = "absolute";
    view.style.inset = "0";
    view.style.inlineSize = "100%";
    view.style.blockSize = "100%";
    view.style.border = "0";
    view.setAttribute("window", id);
    document.body.append(view);
  };

  document.body.style.margin = "0";
  const drawn = new Set();
  desktop.addEventListener("browserwindowschanged", () => {
    for (const window of desktop.browserWindows ?? []) {
      if (!drawn.has(window.id)) {
        drawn.add(window.id);
        draw(window.id);
        say(`drawn id=${window.id}`);
      }
    }
  });

  say("shell-loaded");
};
