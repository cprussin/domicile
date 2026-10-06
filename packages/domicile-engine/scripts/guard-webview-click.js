// Shell module for guard-webview-click.sh: one browser window under a strip of
// shell UI, clicked in both halves.
//
// It is a module because the engine writes the shell's document and loads one
// module into it (see ShellURLLoaderFactory::ShellDocument). It is a
// domicile:// document because the browser binds WebViewGuestHost only for the
// shell's origin.
//
// A shell raises the browser window the user clicks in, but the page inside is
// a guest in another process, so no pointer or focus event crosses back out
// (see `FocusController::SetFocusedFrame`). The fork makes the element fire
// `domicile-guest-focus`, which is what `BrowserWindow.tsx` listens for.
//
// The strip stands in for the shell's address bar. Clicking it shows a press
// reaches this document at all, so "guest click not reported" is not confused
// with "no click delivered".
//
// Console lines (the engine writes them to its log):
//
//   GUARD chrome-mousedown       a press reached the shell's document (harness
//                                check)
//   GUARD window-reached target= the element reported its guest took focus.
//                                The claim
//   GUARD window-focusin target= an ordinary focus event arrived too, which
//                                shell focus handlers rely on
//   GUARD window-reached-at-elem… the same event heard on the element, to tell
//                                "did not bubble" from "did not fire"
//   GUARD window-active          the element is the document's activeElement
//   GUARD shell-window-blur      this window lost focus. Fired by the same
//                                FocusController call the fork patched, so it
//                                shows focus reached this renderer
//   GUARD shell-focus-state …    activeElement's tag and document.hasFocus(),
//                                whenever they change
//
// The last two locate a failure: if the window blur arrives but nothing
// reaches the element, the fault is in this renderer; if not, the browser
// never reported the focus change.
//
// `GUARD guest-mousedown` and the guest's focus come from the guest page; see
// guard-webview-guest-page.py.
//
// The document Domicile writes calls `Shell` once the module loads.

export const Shell = () => {
  /**
   * Reads a required query parameter. No default, so a misconfigured guard
   * fails instead of measuring something else.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-click: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);

  // The shell's half of the window. A plain <div> takes no focus, so any focus
  // this document reports came from the element.
  const stripHeight = `${required(parameters, "strip")}px`;
  const strip = document.createElement("div");
  strip.style.position = "absolute";
  strip.style.insetBlockStart = "0";
  strip.style.insetInline = "0";
  strip.style.inlineSize = "100%";
  strip.style.blockSize = stripHeight;
  strip.style.background = "#204060";

  // Always a <webview>. An ordinary subframe on a domicile:// document cannot
  // load an http page, so it cannot serve as a control. The control clicks the
  // same page elsewhere; see the guard's header.
  const view = document.createElement("webview");
  view.style.position = "absolute";
  view.style.insetBlockStart = stripHeight;
  view.style.insetInline = "0";
  // Size explicitly. A <webview> is a replaced element, so with `auto` size
  // between insets it takes its intrinsic 300x150 instead of filling them.
  view.style.inlineSize = "100%";
  view.style.blockSize = `calc(100% - ${stripHeight})`;
  view.style.border = "0";

  // The claim: the element reports its guest took focus. Shells raise windows
  // on this. Listen on the document because shells rely on it bubbling.
  //
  // Upstream, focusing the element sets activeElement but fires no event:
  // Document::SetFocusedElement dispatches focus events only while the page is
  // focused, and a guest taking focus unfocuses it. The fork sends both this
  // and `focusin`.
  document.addEventListener("domicile-guest-focus", (event) => {
    say(`window-reached target=${event.target.localName}`);
    if (document.activeElement === view) {
      say("window-active");
    }
  });

  // The ordinary focus event, which upstream suppresses here and the fork sends
  // (HTMLWebViewElement::DispatchSuppressedFocus). Shell focus-out dismissal,
  // focus traps and React's onFocus depend on it.
  document.addEventListener("focusin", (event) => {
    say(`window-focusin target=${event.target.localName}`);
  });

  // The same event on the element. If this fires and the document listener
  // does not, the event did not bubble; if neither fires, it was never
  // dispatched.
  view.addEventListener("domicile-guest-focus", () => {
    say("window-reached-at-element");
  });

  // Harness check: a press landed in this document.
  document.addEventListener("mousedown", (event) => {
    say(`chrome-mousedown target=${event.target.localName}`);
  });

  // Focus leaving this document, as a guest taking focus looks from here.
  // Shows the browser told this renderer focus moved.
  // `FocusController::SetFocusedFrame` dispatches it right after the fork's
  // branch.
  addEventListener("blur", () => {
    say("shell-window-blur");
  });

  addEventListener("focus", () => {
    say("shell-window-focus");
  });

  // Poll where focus is: no event announces focus moving to another process.
  let reported = "";
  setInterval(() => {
    const now = `element=${document.activeElement?.localName} hasFocus=${document.hasFocus()}`;
    if (now !== reported) {
      reported = now;
      say(`shell-focus-state ${now}`);
    }
  }, 250);

  document.body.style.margin = "0";
  document.body.append(strip);

  // Set `src` last: it requests a guest, which needs the element in the
  // document.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  // Nothing here focuses the element. The real shell does (`view.focus()` in
  // `BrowserWindow.tsx`), but the guard checks whether a press inside the
  // guest alone reaches this document.
  say("shell-loaded");
};
