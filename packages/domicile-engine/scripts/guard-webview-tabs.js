// The shell guard-webview-tabs.sh drives: two browser windows, one of them
// focused, and an extension's popup asking which is the active tab.
//
// It logs to the console, which the engine writes to its own log:
//
//   GUARD listening            the desktop reached Shell and a listener is
//                              registered
//   GUARD page name=… url=…    window `a` or `b` is showing a page
//   GUARD tray popup=…         the fixture's row arrived, naming its popup
//   GUARD focused name=…       this page focused that window, `?focus=`
//   GUARD answer active=…      the popup's tabs.query answer, read from the
//                              popup's address. This is what the guard checks
//   GUARD answer zoom=…        what the popup's tabs.getZoom read after its
//                              tabs.setZoom on that tab
//   GUARD zoom name=… factor=… window `a` or `b`'s element saw its zoom
//                              change, to two decimal places
//
// Both windows are created before the popup, and the popup is never focused.
// The guard runs twice, focusing each window, so an active tab picked by
// creation order gives a wrong answer in one of the runs.

export const Shell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  /**
   * Reads a required query parameter. Throws when missing: a default would
   * measure a setup the guard did not ask for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-tabs: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-tabs: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const expected = required(parameters, "expect");
  const addresses = {
    a: required(parameters, "a"),
    b: required(parameters, "b"),
  };
  const focus = required(parameters, "focus");

  // Delay before opening the popup. Focus and the popup's query reach the
  // browser over different pipes, so focus must land first.
  const SETTLE_MS = 1000;

  /** A <webview> at `src`, calling `shown` with its address on every page. */
  const view = (src, shown) => {
    const element = document.createElement("webview");
    element.style.position = "absolute";
    element.style.inlineSize = "30%";
    element.style.blockSize = "50%";
    element.style.border = "0";
    element.addEventListener("domicile-page-change", () => {
      shown(element.url);
    });
    // Set `src` after insertion: it asks for a guest, which needs a frame.
    document.body.append(element);
    element.setAttribute("src", src);
    return element;
  };

  const shown = new Set();
  let focused = false;
  let popup;
  let opened = false;

  const openPopupOnceReady = () => {
    if (focused && popup !== undefined && !opened) {
      opened = true;
      setTimeout(() => {
        view(popup, (url) => {
          const answered = new URL(url).searchParams;
          const active = answered.get("active");
          if (active !== null) {
            say(`answer active=${active}`);
            say(`answer zoom=${answered.get("zoom")}`);
          }
        });
      }, SETTLE_MS);
    }
  };

  const windows = Object.fromEntries(
    Object.entries(addresses).map(([name, src]) => [
      name,
      view(src, (url) => {
        say(`page name=${name} url=${url}`);
        shown.add(name);
        if (!focused && shown.size === 2) {
          focused = true;
          windows[focus].focus();
          say(`focused name=${focus}`);
          openPopupOnceReady();
        }
      }),
    ]),
  );

  // Only the popup zooms, so any zoom change a window sees came from it.
  for (const [name, element] of Object.entries(windows)) {
    element.addEventListener("domicile-zoom-change", () => {
      say(`zoom name=${name} factor=${element.zoom.toFixed(2)}`);
    });
  }

  host.addEventListener("extensionschanged", () => {
    const row = host.extensions.find((extension) => extension.id === expected);
    if (row !== undefined && row.popup !== null && popup === undefined) {
      popup = row.popup;
      say(`tray popup=${popup}`);
      openPopupOnceReady();
    }
  });
  say("listening");
};
