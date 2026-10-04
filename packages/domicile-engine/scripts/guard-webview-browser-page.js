// Shell module for guard-webview-browser-page.sh: one browser window that loads
// an ordinary page, then the address under test.
//
// It is a module because the engine writes the shell's document and loads one
// module into it. It is a domicile:// document because the browser binds
// WebViewGuestHost only for that origin.
//
// The ordinary page's `guest-loaded` line (from guard-webview-guest-page.py)
// shows a guest was made and navigated, so a run that failed earlier is not
// read as a refusal. `then` is chrome://history in the run and the same page
// under another host in the control.
//
// Console lines (the engine writes them to its log):
//
//   GUARD then url=…   the second address was handed to the window.
//                      Diagnostic only

/**
 * Reads a required query parameter. No default, so a misconfigured guard
 * fails instead of measuring something else.
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

// Navigate once the first page finishes loading. The event carries no data,
// so read the element.
let handedOn = false;
view.addEventListener("domicile-loading-change", () => {
  if (!handedOn && !view.loading && (view.url ?? "") !== "") {
    handedOn = true;
    say(`then url=${then}`);
    view.setAttribute("src", then);
  }
});

// Set `src` last: it requests a guest, which needs the element in the
// document.
document.body.append(view);
view.setAttribute("src", first);
