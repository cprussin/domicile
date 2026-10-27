/** Every window side by side, the focused one outlined. */
export const Shell = (root, domicile) => {
  const main = document.createElement("main");
  main.style.cssText = "display: flex; gap: 8px; height: 100vh; padding: 8px";
  root.append(main);
  const shown = new Map();

  const draw = () => {
    // Menus and tooltips have a parent. This shell leaves them out.
    const windows = (domicile.windows.list ?? []).filter(
      (window) => window.parent === undefined,
    );
    for (const [appId, app] of shown) {
      if (!windows.some((window) => window.appId === appId)) {
        app.remove();
        shown.delete(appId);
      }
    }
    for (const { appId } of windows) {
      let app = shown.get(appId);
      if (app === undefined) {
        app = document.createElement("app");
        app.setAttribute("app-id", appId);
        app.style.cssText = "border-radius: 8px; flex: 1";
        main.append(app);
        shown.set(appId, app);
      }
      app.style.outline =
        appId === domicile.windows.focused ? "2px solid royalblue" : "none";
    }
  };

  draw();
  domicile.windows.on("change", draw);
  domicile.windows.on("focuschange", draw);
};
