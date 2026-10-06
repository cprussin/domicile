// Shell module for guard-webview-active-tab.sh: one browser window, focused,
// and a click on the fixture's action in the tray.
//
// Console lines (the engine writes them to its log):
//
//   GUARD listening        the desktop was handed to Shell and a listener is
//                          registered (harness check)
//   GUARD tray id=…        the fixture's row arrived, badged: it is installed
//                          and its onClicked listener is registered
//   GUARD focused          the window finished loading its page and this
//                          focused it
//   GUARD activated id=…   this clicked the fixture's action, `?activate=1`
//
// The claim is the color the guard's probe reads; only a tab the click granted
// activeTab on can be painted.
//
// Domicile's document calls `Shell` once the module has loaded.

export const Shell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  /**
   * Reads a required query parameter. No default, so a misconfigured guard
   * fails instead of measuring something else.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-active-tab: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-active-tab: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const expected = required(parameters, "expect");
  const activate = required(parameters, "activate") === "1";

  // How long after the focus the action is clicked: the element tells the
  // browser it was focused over one pipe, and the click goes over another.
  const SETTLE_MS = 1000;

  const view = document.createElement("webview");

  // Inset on the witness, in whole percentages, as in
  // guard-webview-content-script.js.
  view.style.position = "absolute";
  view.style.left = "10%";
  view.style.top = "10%";
  view.style.width = "80%";
  view.style.height = "70%";
  view.style.border = "0";

  document.body.style.background = `#${required(parameters, "witness")}`;

  let focused = false;
  let installed = false;
  let clicked = false;

  const clickOnceReady = () => {
    if (focused && installed && activate && !clicked) {
      clicked = true;
      setTimeout(() => {
        host.activateExtension(expected);
        say(`activated id=${expected}`);
      }, SETTLE_MS);
    }
  };

  const src = required(parameters, "src");

  // Focus only once the page reports `#ready`. activeTab grants the committed
  // page, and `view.url`/`loading` can reflect a pending or aborted load.
  const focusOnceArrived = () => {
    if (!focused && view.url === `${src}#ready` && !view.loading) {
      focused = true;
      view.focus();
      say("focused");
      clickOnceReady();
    }
  };
  view.addEventListener("domicile-page-change", focusOnceArrived);
  view.addEventListener("domicile-loading-change", focusOnceArrived);

  host.addEventListener("extensions", (event) => {
    if (
      !installed &&
      event.extensions.some(
        (extension) =>
          extension.id === expected && extension.badgeText === "on",
      )
    ) {
      installed = true;
      say(`tray id=${expected}`);
      clickOnceReady();
    }
  });
  say("listening");

  // Set `src` last: it requests the guest, and the element needs a frame
  // first.
  document.body.append(view);
  view.setAttribute("src", src);
};
