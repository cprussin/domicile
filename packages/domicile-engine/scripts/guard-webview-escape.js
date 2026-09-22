// The shell guard-webview-escape.sh drives: one browser window on the page,
// and the keyboard left where it starts.
//
// A module rather than a page, because that is what a shell is here — the
// engine writes the document and loads exactly one module into it, so a guard
// that shipped its own HTML would be running a configuration the product does
// not have. See ShellURLLoaderFactory::ShellDocument. It has to be a
// domicile:// document for the reason the other <webview> guards' modules are:
// the browser binds WebViewGuestHost only for the shell's origin, so a
// <webview> anywhere else cannot ask for a guest at all.
//
// NOTHING HERE FOCUSES THE WINDOW, and that is the experiment rather than an
// omission. The crash this guard is about is on the EMBEDDER's WebContents —
// the shell's — and it is reached through the `BrowserPluginEmbedder` a guest's
// attach builds there. A key sent to a focused guest is answered by the guest's
// own WebContents, which has no embedder behind it, so a run that handed the
// window the keyboard would press Escape at the one WebContents that cannot
// reach the defect. `guard-webview-keyboard.js` is the mirror of this and
// focuses the element on purpose; here the keyboard stays in this document,
// which is where a desktop's keys arrive and where the Escape that took the
// desktop down was pressed.
//
// WHAT THIS PAGE SAYS, to the console, which the engine writes to its own log:
//
//   GUARD document-keydown code=…  a key became a DOM event in the SHELL's
//                                  document. Diagnostics and not a reading:
//                                  the guard's claims are all measured in the
//                                  browser process, and a page in a window no
//                                  display can activate may be sent no key
//                                  events at all — which is a fact about this
//                                  harness rather than about the press
//
// The line that IS read comes from the page in the window: `guest-loaded`, out
// of guard-webview-guest-page.py. That is what says a guest was made, attached
// and navigated, and so that the shell's WebContents is an embedder.

/**
 * A query parameter this cannot run without. Missing means the guard invoked
 * this wrongly, and a default would turn that into a measurement of something
 * nobody asked for.
 */
const required = (parameters, name) => {
  const value = parameters.get(name);
  if (value === null) {
    throw new Error(`guard-webview-escape: ?${name}= is required`);
  } else {
    return value;
  }
};

const say = (what) => {
  console.log(`GUARD ${what}`);
};

const parameters = new URLSearchParams(location.search);
const view = document.createElement("webview");

view.style.position = "absolute";
view.style.inset = "0";
view.style.inlineSize = "100%";
view.style.blockSize = "100%";
view.style.border = "0";

document.addEventListener("keydown", (event) => {
  say(`document-keydown code=${event.code}`);
});

// `src` last, and this is the order that matters: it is what makes a <webview>
// ask for a guest, and setting it before the element is in the document would
// ask before there is a frame to attach one to.
document.body.append(view);
view.setAttribute("src", required(parameters, "src"));
