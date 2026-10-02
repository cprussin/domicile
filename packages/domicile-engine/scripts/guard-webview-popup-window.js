// The shell guard-webview-popup-window.sh drives: one browser window, focused,
// an extension's popup asking for a popup window with windows.create, and the
// <webview> this page opens for that window.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to its
// own log:
//
//   GUARD listening              navigator.domicile exists and a listener is
//                                registered -- the harness working
//   GUARD page url=…             the browser window is showing its page
//   GUARD focused                this page focused it
//   GUARD tray popup=…           the fixture's row arrived, naming its popup
//   GUARD asked id=… width=… height=…
//                                `domicile-popup-window` reached this page:
//                                the engine asked for the window's tab
//   GUARD window current=… type=… found=…
//                                what the window's page heard of the window
//                                it is in. THE CLAIM
//   GUARD window closed          its windows.remove, as `domicile-close`
//   GUARD created id=… tabs=…    windows.create's answer, read off the
//                                popup's own address
//
// `?name=1` names the window on the <webview> it opens, in `popupwindow`;
// `?name=0` is the control's, which opens the same <webview> without it.

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

const host = navigator.domicile;
if (host === null || host === undefined) {
  throw new Error(
    "guard-webview-popup-window: navigator.domicile is absent, so this" +
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
 * A <webview> at `src`, calling `shown` with its address on every page.
 * `popupWindow` is set before the element is in the document: it is read when
 * the element asks for its guest, which inserting it does.
 */
const view = (src, shown, popupWindow) => {
  const element = document.createElement("webview");
  element.style.position = "absolute";
  element.style.inlineSize = "30%";
  element.style.blockSize = "50%";
  element.style.border = "0";
  if (popupWindow !== undefined) {
    element.setAttribute("popupwindow", popupWindow);
  }
  element.addEventListener("domicile-page-change", () => {
    shown(element.url);
  });
  // `src` last: it is what asks for a guest, and the element needs a frame
  // first.
  document.body.append(element);
  element.setAttribute("src", src);
  return element;
};

let focused = false;
let popup;
let opened = false;

const openPopupOnceReady = () => {
  if (focused && popup !== undefined && !opened) {
    opened = true;
    setTimeout(() => {
      view(popup, (url) => {
        const answered = new URL(url).searchParams;
        const created = answered.get("created");
        if (created !== null) {
          say(`created id=${created} tabs=${answered.get("tabs")}`);
        }
      });
    }, SETTLE_MS);
  }
};

const browserWindow = view(address, (url) => {
  say(`page url=${url}`);
  if (!focused) {
    focused = true;
    browserWindow.focus();
    say("focused");
    openPopupOnceReady();
  }
});

// The engine asks through the element of the active tab, which is the
// browser window's, and the event bubbles: heard here, once.
let asked = false;
document.addEventListener("domicile-popup-window", (event) => {
  if (asked) {
    return;
  }
  asked = true;
  say(`asked id=${event.windowId} width=${event.width} height=${event.height}`);
  const popupView = view(
    event.url,
    (url) => {
      const answered = new URL(url).searchParams;
      const current = answered.get("current");
      if (current !== null) {
        say(
          `window current=${current} type=${answered.get("type")}` +
            ` found=${answered.get("found")} named=${event.windowId}`,
        );
      }
    },
    naming ? String(event.windowId) : undefined,
  );
  popupView.addEventListener("domicile-close", () => {
    say("window closed");
  });
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
