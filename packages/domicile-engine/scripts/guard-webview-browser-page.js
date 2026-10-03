// The shell guard-webview-browser-page.sh drives: one browser window, an
// ordinary page in it, and then the address under test in the same window.
//
// A module rather than a page, for the reason every shell guard's is: the
// engine writes the document and loads exactly one module into it. And a
// domicile:// document, because the browser binds WebViewGuestHost for that
// origin and no other.
//
// AN ORDINARY PAGE FIRST, AND THEN `then`. The first page is what says a guest
// was made, attached and navigated -- its `guest-loaded` line, out of
// guard-webview-guest-page.py -- so a run that never got that far is told
// apart from one whose second address was refused. `then` is chrome://history
// in the run and the same page under another host in the control.
//
// WHAT THIS PAGE SAYS, to the console, which the engine writes to its own log:
//
//   GUARD then url=…   the second address was handed to the window. Diagnostics:
//                      the readings are the guest page's and the browser's

/**
 * A query parameter this cannot run without. Missing means the guard invoked
 * this wrongly, and a default would turn that into a measurement of something
 * nobody asked for.
 */
const required = (parameters, name) => {
  const value = parameters.get(name);
  if (value === null) {
    throw new Error(`guard-webview-browser-page: ?${name}= is required`);
  } else {
    return value;
  }
};

const say = (what) => {
  console.log(`GUARD ${what}`);
};

const parameters = new URLSearchParams(location.search);
const first = required(parameters, "src");
const then = required(parameters, "then");
const view = document.createElement("webview");

view.style.position = "absolute";
view.style.inset = "0";
view.style.inlineSize = "100%";
view.style.blockSize = "100%";
view.style.border = "0";

// Once, when the first page has finished arriving. Read off the element rather
// than taken from the event, which carries nothing.
let handedOn = false;
view.addEventListener("domicile-loading-change", () => {
  if (!handedOn && !view.loading && (view.url ?? "") !== "") {
    handedOn = true;
    say(`then url=${then}`);
    view.setAttribute("src", then);
  }
});

// `src` last: it is what makes a <webview> ask for a guest, and before the
// element is in the document there is no frame to attach one to.
document.body.append(view);
view.setAttribute("src", first);
