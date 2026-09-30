// The shell guard-webview-active-tab.sh drives: one browser window, focused,
// and a click on the fixture's action in the tray.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to its
// own log:
//
//   GUARD listening        navigator.domicile exists and a listener is
//                          registered -- the harness working
//   GUARD tray id=…        the fixture's row arrived: it is installed
//   GUARD focused          the window finished loading its page and this
//                          focused it
//   GUARD activated id=…   this clicked the fixture's action, `?activate=1`
//
// THE CLAIM IS NOT HERE. It is a color in the window, read by the guard's
// probe: the fixture's onClicked paints the tab it is handed, and only a page
// the click granted it activeTab on can be painted.

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
    throw new Error(`guard-webview-active-tab: ?${name}= is required`);
  } else {
    return value;
  }
};

const host = navigator.domicile;
if (host === null || host === undefined) {
  throw new Error(
    "guard-webview-active-tab: navigator.domicile is absent, so this document" +
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

// Inset on the witness, in whole percentages, as guard-webview-content-script.js.
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

// FOCUSED ONCE THE PAGE HAS ARRIVED, not on the first page change: that can
// be the guest's address moving before the page commits, and activeTab grants
// the page the tab is showing when the click lands. A grant on the page before
// this one is revoked when this one commits, and the fixture is then refused.
const focusOnceArrived = () => {
  if (!focused && view.url === src && !view.loading) {
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
    event.extensions.some((extension) => extension.id === expected)
  ) {
    installed = true;
    say(`tray id=${expected}`);
    clickOnceReady();
  }
});
say("listening");

// `src` last: it is what asks for a guest, and the element needs a frame first.
document.body.append(view);
view.setAttribute("src", src);
