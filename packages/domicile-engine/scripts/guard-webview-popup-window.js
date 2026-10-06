// The shell module guard-webview-popup-window.sh loads: one focused browser
// window, an extension popup that calls windows.create for a popup window, and
// the browser window the engine opens for it.
//
// Console output, which the engine writes to its log:
//
//   GUARD listening              a listener is registered (harness check)
//   GUARD page url=…             the browser window is showing its page
//   GUARD focused                this page focused it
//   GUARD tray popup=…           the fixture's row arrived, naming its popup
//   GUARD asked id=… width=… height=…
//                                a browser window for popup window `id`'s tab
//                                reached the desk's list at that size
//   GUARD window current=… type=… found=…
//                                what the page in the drawn window reports
//                                about its own window
//   GUARD window closed          the drawn window left the list after its
//                                windows.remove
//   GUARD created id=… tabs=…    windows.create's result, read from the
//                                popup's address
//
// `?name=1` draws the engine's browser window with `<webview window>`.
// `?name=0` is the negative control: it leaves that window undrawn and opens
// its own at the same page, as a tab of the desk's own window.
//
// The engine's document calls `Shell` once the module loads.

export const Shell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  /**
   * Reads a required query parameter. No default, so a misconfigured guard
   * fails instead of measuring the wrong thing.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-popup-window: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-popup-window: no desktop was handed to Shell, so this" +
        " document was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const expected = required(parameters, "expect");
  const address = required(parameters, "a");
  const naming = required(parameters, "name") === "1";

  // Delay between focusing and opening the popup: focus and the popup's request
  // reach the browser over different pipes, so they can arrive out of order.
  const SETTLE_MS = 1000;

  /**
   * Creates a <webview> showing `src` or browser window `window`, and calls
   * `shown` with each page's address.
   *
   * `window` must be set before attaching, since the element requests its page
   * on attach.
   */
  const view = ({ src, window }, shown) => {
    const element = document.createElement("webview");
    element.style.position = "absolute";
    element.style.inlineSize = "30%";
    element.style.blockSize = "50%";
    element.style.border = "0";
    if (window !== undefined) {
      element.setAttribute("window", window);
    }
    element.addEventListener("domicile-page-change", () => {
      shown(element.url);
    });
    document.body.append(element);
    if (src !== undefined) {
      element.setAttribute("src", src);
    }
    return element;
  };

  let focused = false;
  let popup;
  let opened = false;

  const openPopupOnceReady = () => {
    if (focused && popup !== undefined && !opened) {
      opened = true;
      setTimeout(() => {
        view({ src: popup }, (url) => {
          const answered = new URL(url).searchParams;
          const created = answered.get("created");
          if (created !== null) {
            say(`created id=${created} tabs=${answered.get("tabs")}`);
          }
        });
      }, SETTLE_MS);
    }
  };

  const browserWindow = view({ src: address }, (url) => {
    say(`page url=${url}`);
    if (!focused) {
      focused = true;
      browserWindow.focus();
      say("focused");
      openPopupOnceReady();
    }
  });

  // The engine's window for the popup window, from the desk's list. This
  // document's own `<webview src>` is in no list. The negative control's
  // window is told apart by its id.
  let asked;
  let drawn;
  let gone = false;
  host.addEventListener("browserwindowschanged", () => {
    const windows = host.browserWindows ?? [];
    const popupWindow = windows.find((window) => window.popupWindow !== null);
    if (asked === undefined && popupWindow !== undefined) {
      asked = popupWindow.popupWindow;
      say(
        `asked id=${asked} width=${popupWindow.width} height=${popupWindow.height}`,
      );
      const reading = (url) => {
        const answered = new URL(url).searchParams;
        const current = answered.get("current");
        if (current !== null) {
          say(
            `window current=${current} type=${answered.get("type")}` +
              ` found=${answered.get("found")} named=${asked}`,
          );
        }
      };
      if (naming) {
        drawn = popupWindow.id;
        view({ window: drawn }, reading);
      } else {
        // The negative control opens the same page itself, as a tab of the
        // desk's own window, and draws it once it is in the list.
        const ownUrl = popupWindow.url;
        const ownWindow = () =>
          (host.browserWindows ?? []).find(
            (window) => window.popupWindow === null && window.url === ownUrl,
          );
        const drawOwn = () => {
          const own = ownWindow();
          if (drawn === undefined && own !== undefined) {
            drawn = own.id;
            view({ window: drawn }, reading);
          }
        };
        host.addEventListener("browserwindowschanged", drawOwn);
        host.openBrowserWindow(ownUrl);
      }
    }
    if (
      drawn !== undefined &&
      !gone &&
      !windows.some((window) => window.id === drawn)
    ) {
      gone = true;
      say("window closed");
    }
  });

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
