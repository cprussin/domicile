// The shell guard-webview-routed-link.sh drives: one browser window, whose page
// holds a single ordinary link.
//
// A module rather than a page, because that is what a shell is here — the
// engine writes the document and loads exactly one module into it, so a guard
// that shipped its own HTML would be running a configuration the product does
// not have. See ShellURLLoaderFactory::ShellDocument. It has to be a
// domicile:// document for a further reason: the browser binds WebViewGuestHost
// only for the shell's origin, so a <webview> anywhere else cannot ask for a
// guest at all.
//
// WHAT THIS PAGE REPORTS, AND WHY IT IS EXACTLY TWO THINGS.
//
// A PRESS LANDING IN ITS OWN CHROME, which is the reading that makes every
// absence below a measurement: a run where no click reaches this browser at
// all looks exactly like a run where one did and nothing came of it.
// `guard-webview-click.sh` is where that lesson was paid for.
//
// AND THE WINDOW THE GUEST ASKS FOR. The subject is a MIDDLE CLICK on an
// ordinary link — a gesture asking for that link in a SECOND window, which a
// page cannot open. It reaches `WebContentsDelegate::OpenURLFromTab` on the
// guest, which refuses to open one and announces the address here instead. So
// this event is half the claim, and the address on it is what says the right
// link was announced rather than merely something having happened.
//
// WHAT THIS PAGE DOES NOT DO IS OPEN THE SECOND WINDOW. A real shell would,
// and `guard-webview-new-window.js` does exactly that for the `target="_blank"`
// path. Here it would measure nothing this guard is about and would cost a
// second guest to attach and navigate — the question is whether the DELEGATE
// was asked and answered, and the engine's own log plus this event are both
// halves of it. The guard tells the two paths apart by that log line, because
// `ReportNewWindow` is shared and this event alone cannot.

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

// And the claim's other half. The address is logged with the event rather than
// beside it, so a run cannot pass on an announcement about some other page —
// the guard greps for the fixture's own /opened.
view.addEventListener("domicile-new-window", (event) => {
  say(`new-window url=${event.url}`);
});

document.body.style.margin = "0";
document.body.append(strip);

// Last, and this is the order that matters: `src` is what makes a <webview>
// ask for a guest, and setting it before the element is in the document would
// ask before there is a frame to attach one to.
document.body.append(view);
view.setAttribute("src", required(parameters, "src"));

say("shell-loaded");
