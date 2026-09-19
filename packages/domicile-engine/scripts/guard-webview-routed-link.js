// The shell guard-webview-routed-link.sh drives: one browser window, whose page
// holds a frame from another site.
//
// A module rather than a page, because that is what a shell is here — the
// engine writes the document and loads exactly one module into it, so a guard
// that shipped its own HTML would be running a configuration the product does
// not have. See ShellURLLoaderFactory::ShellDocument. It has to be a
// domicile:// document for a further reason: the browser binds WebViewGuestHost
// only for the shell's origin, so a <webview> anywhere else cannot ask for a
// guest at all.
//
// WHAT THIS PAGE IS FOR, AND WHY IT DOES SO LITTLE. The subject is a
// navigation that never reaches this document: a link inside a cross-process
// frame, targeting the page around it, which Blink cannot perform itself and
// hands to the browser instead. It arrives at
// `WebContentsDelegate::OpenURLFromTab` on the guest, and what happens there is
// the whole question. The shell's part is to draw the window and stay out of
// the way — everything this guard reads about the navigation is said by the
// pages inside the guest, or by the engine's own log.
//
// SO THE ONE THING THIS PAGE REPORTS is a press landing in its own chrome,
// which is the reading that makes every absence below a measurement: a run
// where no click reaches this browser at all looks exactly like a run where one
// did and nothing was routed. `guard-webview-click.sh` is where that lesson was
// paid for.
//
// NOTHING HERE LISTENS FOR `domicile-new-window`, and that absence is
// deliberate: a `target="_top"` link asks for no window, so a run where the
// element announced one would mean the browser took a current-tab navigation
// for a new-window one. The guard reads the engine's log for that instead —
// see its header.

/**
 * A query parameter this cannot run without. Missing means the guard invoked
 * this wrongly, and a default would turn that into a measurement of something
 * nobody asked for.
 */
const required = (parameters, name) => {
  const value = parameters.get(name);
  if (value === null) {
    throw new Error(`guard-webview-routed-link: ?${name}= is required`);
  } else {
    return value;
  }
};

const say = (what) => {
  console.log(`GUARD ${what}`);
};

const parameters = new URLSearchParams(location.search);

// The shell's own half of the window, above the element and the height the
// guard clicks into for its first press. A plain <div>: nothing here takes
// focus or navigates.
const stripHeight = `${required(parameters, "strip")}px`;
const strip = document.createElement("div");
strip.style.position = "absolute";
strip.style.insetBlockStart = "0";
strip.style.insetInline = "0";
strip.style.inlineSize = "100%";
strip.style.blockSize = stripHeight;
strip.style.background = "#204060";

// The window's page. Sized rather than stretched between insets, which is the
// mistake the click guard already paid for: a <webview> is a replaced element,
// and an absolutely positioned replaced element with `auto` size takes its
// INTRINSIC size between two insets — 300x150, in the corner — leaving most of
// the window under nothing at all and the guard clicking the page instead of
// the guest.
const view = document.createElement("webview");
view.style.position = "absolute";
view.style.insetBlockStart = stripHeight;
view.style.insetInline = "0";
view.style.inlineSize = "100%";
view.style.blockSize = `calc(100% - ${stripHeight})`;
view.style.border = "0";

// The harness's own reading: a press that landed in this document.
document.addEventListener("mousedown", (event) => {
  say(`chrome-mousedown target=${event.target.localName}`);
});

document.body.style.margin = "0";
document.body.append(strip);

// Last, and this is the order that matters: `src` is what makes a <webview>
// ask for a guest, and setting it before the element is in the document would
// ask before there is a frame to attach one to.
document.body.append(view);
view.setAttribute("src", required(parameters, "src"));

say("shell-loaded");
