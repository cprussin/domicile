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
// The subject is a middle click on an ordinary link: a gesture asking for the
// link in a second window, which a page cannot open. It reaches
// `WebContentsDelegate::OpenURLFromTab` on the guest, which opens a desk
// browser window at the address instead of letting content open one. The
// window in the desk's list is half the claim, and its address shows the
// right link opened.
//
// This page does not draw the second window. `guard-webview-new-window.js`
// does that for `target="_blank"`. This guard asks whether the delegate was
// asked and answered: the engine's log and the list cover both halves. The log
// line tells the two paths apart, because `ReportNewWindow` is shared and the
// list alone cannot.
//
// Everything is inside `Shell`, which the document Domicile writes calls once
// the module has loaded.

export const Shell = () => {
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

  // The claim's other half: a browser window for the link in the desk's list.
  // The address is logged on the same line, so a window at another page
  // cannot pass; the guard greps for the fixture's /opened. This page's own
  // <webview> is the shell's page, so it is in no list.
  const host = navigator.domicile;
  if (host === undefined) {
    throw new Error(
      "guard-webview-routed-link: navigator.domicile is absent, so this" +
        " document is not a shell the engine serves",
    );
  }
  host.addEventListener("browserwindowschanged", () => {
    for (const window of host.browserWindows ?? []) {
      say(`new-window url=${window.url}`);
    }
  });

  // Where this window went, which a middle click must not change. Read from the
  // element, not the page: /opened also loads in the browser's new window, so
  // the page's own line cannot say which window it is in.
  view.addEventListener("domicile-page-change", () => {
    say(`first-page url=${view.url}`);
  });

  document.body.style.margin = "0";
  document.body.append(strip);

  // Last, and this is the order that matters: `src` is what makes a <webview>
  // ask for a guest, and setting it before the element is in the document would
  // ask before there is a frame to attach one to.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
