// The shell guard-webview-tabs.sh drives: two browser windows, one of them
// focused, and an extension's popup asking which is the active tab.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to its
// own log:
//
//   GUARD listening            navigator.domicile exists and a listener is
//                              registered -- the harness working
//   GUARD page name=… url=…    window `a` or `b` is showing a page
//   GUARD tray popup=…         the fixture's row arrived, naming its popup
//   GUARD focused name=…       this page focused that window, `?focus=`
//   GUARD answer active=…      the popup's tabs.query answer, read off the
//                              popup's own address. THE CLAIM
//
// THE ORDER IS THE POINT. Both windows are made first and the popup last, and
// the popup's <webview> is never focused: so a desk whose active tab were the
// first made, or the last, answers the same whichever window this focuses --
// and the guard runs it twice, focusing each.

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
    throw new Error(`guard-webview-tabs: ?${name}= is required`);
  } else {
    return value;
  }
};

const host = navigator.domicile;
if (host === null || host === undefined) {
  throw new Error(
    "guard-webview-tabs: navigator.domicile is absent, so this document" +
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

// How long after the focus the popup is opened: the element tells the browser
// it was focused over one pipe, and the popup asks over another.
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
  // `src` last: it is what asks for a guest, and the element needs a frame
  // first.
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
        const active = new URL(url).searchParams.get("active");
        if (active !== null) {
          say(`answer active=${active}`);
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

host.addEventListener("extensions", (event) => {
  const row = event.extensions.find((extension) => extension.id === expected);
  if (row !== undefined && row.popup !== null && popup === undefined) {
    popup = row.popup;
    say(`tray popup=${popup}`);
    openPopupOnceReady();
  }
});
say("listening");
