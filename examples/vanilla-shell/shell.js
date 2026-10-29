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

  // A box that runs the command typed in it.
  const launcher = document.createElement("form");
  launcher.style.cssText =
    "bottom: 16px; left: 50%; position: fixed; translate: -50%";
  launcher.innerHTML = `<input name="command" placeholder="Run an app, like firefox">`;
  launcher.addEventListener("submit", (event) => {
    event.preventDefault();
    const argv = launcher.command.value.split(" ").filter(Boolean);
    if (argv.length > 0) {
      domicile.processes.launch(argv);
    }
    launcher.reset();
  });
  root.append(launcher);

  // A terminal on Meta+Enter.
  domicile.keyboard.grab("Meta+Return");
  domicile.keyboard.on("shortcut", ({ chord }) => {
    if (chord === "Meta+Return") {
      domicile.processes.launch(["kitty"]);
    }
  });
};
