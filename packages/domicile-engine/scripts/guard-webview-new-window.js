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
// What it tests: a link with `target="_blank"` inside a browser window. The
// page is a guest, which has no SiteInstance of its own. That keeps the user
// logged in, and content CHECKs it in `WebContentsImpl::CreateNewWindow`, so
// the browser refuses the window content would make. It opens a desk browser
// window at that address instead. The shell gets `browserwindowschanged` with
// an undrawn window in `browserWindows`, and draws it in a second `<webview>`
// naming the window.
//
// The second view is required. A window in the list is not a window on screen,
// so a run that only read the list would pass a desktop that shows the user
// nothing. The page in the second element logging that it ran is the one
// reading no earlier step can fake.
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
//   GUARD new-window url=…      the claim: an undrawn browser window, and its
//                               address, appeared in the desk's list
//   GUARD second-view           a second <webview> naming it was made: the
//                               shell acted, not just received the list
//   GUARD second-page url=…     the second <webview> shows that page, so the
//                               window's page was attached to it
//
// The page in the window says `GUARD opener-loaded` and `GUARD guest-mousedown`
// for itself, and the page the new window lands on says `GUARD opened-loaded`;
// see guard-webview-new-window-server.py.
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

  // The claim: a browser window the desk opened, not this page. This
  // document's own `<webview src>` is in no list, so every listed window is one
  // a page asked for.
  const host = navigator.domicile;
  if (host === undefined) {
    throw new Error(
      "guard-webview-new-window: navigator.domicile is absent, so this" +
        " document is not a shell the engine serves",
    );
  }
  const drawn = new Set();
  host.addEventListener("browserwindowschanged", () => {
    for (const window of host.browserWindows ?? []) {
      if (!drawn.has(window.id)) {
        drawn.add(window.id);
        say(`new-window url=${window.url}`);

        // Draw the window in a second element, stacked over the first: the
        // guard measures that the page arrives, not where the box is. `window`
        // is set before the element enters the document, when it asks for
        // its page.
        const opened = viewFilling();
        opened.setAttribute("window", window.id);
        // Read what the element shows, not the page's own line: the window's
        // page loads whether or not anything draws it. The element learns its
        // page on attach.
        opened.addEventListener("domicile-page-change", () => {
          say(`second-page url=${opened.url}`);
        });
        document.body.append(opened);
        say("second-view");
      }
    }
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
};
