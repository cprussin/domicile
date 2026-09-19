// The shell guard-webview-new-window.sh drives: one browser window, and
// whatever second one its page asks for.
//
// A module rather than a page, because that is what a shell is here — the
// engine writes the document and loads exactly one module into it, so a guard
// that shipped its own HTML would be running a configuration the product does
// not have. See ShellURLLoaderFactory::ShellDocument. It has to be a
// domicile:// document for a further reason: the browser binds WebViewGuestHost
// only for the shell's origin, so a <webview> anywhere else cannot ask for a
// guest at all.
//
// WHAT THIS PAGE IS FOR. A link with `target="_blank"` inside a browser window
// used to do nothing whatsoever. The page in one is a guest, and a guest has no
// SiteInstance of its own — which is what keeps the user logged in, and which
// content CHECKs against the WebContents in `WebContentsImpl::CreateNewWindow`
// — so the browser refuses the window content would have made. It now reports
// the address instead, and opening a window is the shell's: a second
// `<webview>`, in a second window it drew, pointed at what the page asked for.
// That is what this page does, in the smallest form that is still the real
// thing.
//
// THE SECOND VIEW IS THE POINT, and it is why this page does more than log.
// An event is not a window: a run that read only "the shell was told" would
// pass with a desktop where `target="_blank"` still shows the user nothing. So
// the address goes into a second element, that element gets a guest of its own,
// and the page at the far end says it ran — which is the reading no earlier
// step can fake.
//
// THE STRIP IS NOT DECORATION. It is the shell's own half of the window — an
// address bar, in the desktop this stands for — and it is what the guard clicks
// to establish that a press driven at this browser reaches this document at
// all. Without that reading, "the link asked for nothing" and "no click was
// delivered anywhere" are the same run. `guard-webview-click.sh` is where that
// lesson was paid for.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to its
// own log:
//
//   GUARD shell-loaded          this module ran and the window is set up
//   GUARD chrome-mousedown      a press reached the SHELL's document, which is
//                               the harness working rather than a finding
//   GUARD new-window url=…      THE CLAIM: the element said its page asked for
//                               a window, and at which address
//   GUARD second-view           a second <webview> was made and pointed there,
//                               which separates "the shell was told" from "the
//                               shell acted"
//
// The page in the window says `GUARD opener-loaded` and `GUARD guest-mousedown`
// for itself, and the page the new window lands on says `GUARD opened-loaded`;
// see guard-webview-new-window-server.py.

/**
 * A query parameter this cannot run without. Missing means the guard invoked
 * this wrongly, and a default would turn that into a measurement of something
 * nobody asked for.
 */
const required = (parameters, name) => {
  const value = parameters.get(name);
  if (value === null) {
    throw new Error(`guard-webview-new-window: ?${name}= is required`);
  } else {
    return value;
  }
};

const say = (what) => {
  console.log(`GUARD ${what}`);
};

const parameters = new URLSearchParams(location.search);

// The shell's own half of the window, above the element. A plain <div>:
// nothing here takes focus or navigates, so anything this document reports
// about a window came from the element below it.
const stripHeight = `${required(parameters, "strip")}px`;
const strip = document.createElement("div");
strip.style.position = "absolute";
strip.style.insetBlockStart = "0";
strip.style.insetInline = "0";
strip.style.inlineSize = "100%";
strip.style.blockSize = stripHeight;
strip.style.background = "#204060";

/**
 * A browser window's view: the element, sized to the window below the strip.
 *
 * Sized rather than stretched between insets, which is the mistake the click
 * guard already paid for: a <webview> is a replaced element, and an absolutely
 * positioned replaced element with `auto` size takes its INTRINSIC size between
 * two insets — 300x150, in the corner — leaving most of the window under
 * nothing at all and the guard clicking the page instead of the guest.
 */
const viewFilling = () => {
  const view = document.createElement("webview");
  view.style.position = "absolute";
  view.style.insetBlockStart = stripHeight;
  view.style.insetInline = "0";
  view.style.inlineSize = "100%";
  view.style.blockSize = `calc(100% - ${stripHeight})`;
  view.style.border = "0";
  return view;
};

// THE CLAIM: the element saying its page asked for a window of its own.
// Listened for on the document rather than on the element, because bubbling is
// half of what makes it usable — a chrome hangs one handler on the window it
// drew, which is what `BrowserWindow.tsx` does with it.
document.addEventListener("domicile-new-window", (event) => {
  say(`new-window url=${event.url}`);

  // AND THE WINDOW ITSELF, which is the half an event cannot be. A second
  // element, stacked over the first because this guard has no layout and does
  // not need one: what is being measured is that a guest was made for it and
  // the page arrived, and where the box is has nothing to do with either.
  const opened = viewFilling();
  document.body.append(opened);
  opened.setAttribute("src", event.url);
  say("second-view");
});

// The harness's own reading: a press that landed in this document, which is
// what makes every absence below a measurement.
document.addEventListener("mousedown", (event) => {
  say(`chrome-mousedown target=${event.target.localName}`);
});

document.body.style.margin = "0";
document.body.append(strip);

// Last, and this is the order that matters: `src` is what makes a <webview>
// ask for a guest, and setting it before the element is in the document would
// ask before there is a frame to attach one to.
const view = viewFilling();
document.body.append(view);
view.setAttribute("src", required(parameters, "src"));

say("shell-loaded");
