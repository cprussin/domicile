// The shell guard-webview-popup-window.sh drives: one browser window, focused,
// an extension's popup asking for a popup window with windows.create, and the
// browser window the engine opens for it.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to its
// own log:
//
//   GUARD listening              the desktop was handed to Shell and a listener is
//                                registered -- the harness working
//   GUARD page url=…             the browser window is showing its page
//   GUARD focused                this page focused it
//   GUARD tray popup=…           the fixture's row arrived, naming its popup
//   GUARD asked id=… width=… height=…
//                                a browser window, popup window `id`'s tab,
//                                reached the desk's list at that size
//   GUARD window current=… type=… found=…
//                                the claim: what the page in the drawn
//                                window reports about its own window
//   GUARD window closed          the drawn window left the list: its
//                                windows.remove closed it
//   GUARD created id=… tabs=…    windows.create's answer, read off the
//                                popup's own address
//
// `?name=1` draws the engine's browser window with `<webview window>`.
// `?name=0` is the control: it leaves that window undrawn and opens its own at
// the same page, a tab of the desk's own window.
//
// Everything is inside `Shell`, which the document Domicile writes calls once
// the module has loaded.

export const Shell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  /**
   * A query parameter this cannot run without. A default would turn a guard
   * invoked wrongly into a measurement of something nobody asked for.
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

  // How long after the focus the popup is opened: the element tells the browser
  // it was focused over one pipe, and the popup asks over another.
  const SETTLE_MS = 1000;

  /**
   * Makes a <webview> that calls `shown` with each page's address. It shows
   * `src` or browser window `window`, set before the element enters the
   * document, when it asks for its page.
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
  // document's own `<webview src>` is in no list. The control's own window is
  // distinguished by its id.
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
        // The control's window: the same page opened by this shell, so a tab
        // of the desk's own window. Drawn once it is in the list.
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

  host.addEventListener("extensions", (event) => {
    const row = event.extensions.find((extension) => extension.id === expected);
    if (row !== undefined && row.popup !== null && popup === undefined) {
      popup = row.popup;
      say(`tray popup=${popup}`);
      openPopupOnceReady();
    }
  });
  say("listening");
};
