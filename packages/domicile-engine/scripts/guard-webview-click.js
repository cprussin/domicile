// The shell guard-webview-click.sh drives: one browser window with a strip of
// chrome above it, clicked in both halves.
//
// A module rather than a page, because that is what a shell is here — the
// engine writes the document and loads exactly one module into it, so a guard
// that shipped its own HTML would be running a configuration the product does
// not have. See ShellURLLoaderFactory::ShellDocument. It has to be a
// domicile:// document for a further reason: the browser binds WebViewGuestHost
// only for the shell's origin, so a <webview> anywhere else cannot ask for a
// guest at all.
//
// WHAT THIS PAGE IS FOR. A shell raises the window the user clicks in, and for
// a browser window it has nothing to raise it on: the page in one is a guest
// with a browsing context of its own, so no pointer event inside it crosses
// back out. What upstream Blink does with the focus that press takes is
// written in `FocusController::SetFocusedFrame` — "for cross-origin (remote)
// frames, DOM focus events do not cross process boundaries to reach the frame
// owner element in the parent document" — so before the fork's patch there was
// nothing in this document to hear either, and the fork focusing the element
// changed only half of that: focus events are dispatched only while the page
// is focused, and a guest taking focus is the moment it is not. So what this
// page listens for is the element's own event, which is exactly what
// `BrowserWindow.tsx` listens for.
//
// THE STRIP IS NOT DECORATION. It is the shell's own half of the window — an
// address bar, in the desktop this stands for — and it is what the guard
// clicks to establish that a press driven at this browser reaches this
// document at all. Without that reading, "the click in the guest was not
// reported" and "no click was delivered anywhere" are the same run.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to
// its own log:
//
//   GUARD chrome-mousedown       a press reached the SHELL's document, which
//                                is the harness working rather than a finding
//   GUARD window-reached target= the element said its guest took focus. THE
//                                CLAIM, and `target=` is which element said it
//   GUARD window-focusin target= an ordinary focus event arrived too, which is
//                                a reading rather than an assertion: see below
//   GUARD window-reached-at-elem… the same event heard on the element rather
//                                than on the document, which separates a
//                                dispatch that did not travel from one that
//                                did not happen
//   GUARD window-active          the element is this document's activeElement
//                                after it, which is the other half of what the
//                                fork's patch is for
//   GUARD shell-window-blur      this document's window lost focus, which is
//                                dispatched by the same FocusController call
//                                the fork patched — so it says the focus
//                                REACHED this renderer, whatever then happened
//                                to the element
//   GUARD shell-focus-state …    where focus is, whenever that changes: the
//                                activeElement's tag and document.hasFocus()
//
// THE LAST TWO ARE WHY A FAILING RUN IS WORTH ANYTHING. "Nothing arrived" has
// two causes a run cannot otherwise tell apart: the browser never told this
// renderer that focus moved, or it did and nothing came of it at the element.
// The window's own blur is dispatched a dozen lines below the fork's branch in
// FocusController::SetFocusedFrame, so its presence puts the fault on this
// side of the process boundary and its absence puts it on the other. They are
// what found the two-part shape of the fix rather than a second guess at it.
//
// The guest's own `GUARD guest-mousedown`, and whether its window took focus,
// come from the page in the window; see guard-webview-guest-page.py.

/**
 * A query parameter this cannot run without. Missing means the guard invoked
 * this wrongly, and a default would turn that into a measurement of something
 * nobody asked for.
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

// The shell's own half of the window, above the element and the height the
// guard clicks into. A plain <div>: nothing here takes focus, so a focus this
// document reports can only have come from the element below it.
const stripHeight = `${required(parameters, "strip")}px`;
const strip = document.createElement("div");
strip.style.position = "absolute";
strip.style.insetBlockStart = "0";
strip.style.insetInline = "0";
strip.style.inlineSize = "100%";
strip.style.blockSize = stripHeight;
strip.style.background = "#204060";

// Not `document.createElement(kind)` on whatever a query said: this guard has
// one element under test, and the only other element that could stand in for
// it is an ordinary subframe — which on a domicile:// document loads no http
// page at all, so a control written that way would be measuring the load. The
// control is the same page clicked somewhere else; see the guard's header.
const view = document.createElement("webview");
view.style.position = "absolute";
view.style.insetBlockStart = stripHeight;
view.style.insetInline = "0";
// Sized rather than stretched between insets. A <webview> is a replaced
// element, and an absolutely positioned replaced element with `auto` size
// takes its INTRINSIC size between two insets rather than filling them — which
// for a frame owner is 300x150, in the corner, with most of the window under
// nothing at all and the guard clicking the page instead of the guest.
view.style.inlineSize = "100%";
view.style.blockSize = `calc(100% - ${stripHeight})`;
view.style.border = "0";

// THE CLAIM: the element saying its guest took focus, which is the event the
// shell raises a browser window on. Listened for on the document rather than
// on the element, because it bubbling is half of what makes it usable — a
// chrome hangs one handler on the window it drew.
//
// NOT `focusin`, and that is the finding this guard produced rather than an
// assumption it started with: focusing the element buys document.activeElement
// and no event at all, because Document::SetFocusedElement dispatches focus
// events only while the page is focused and a guest taking focus is the moment
// the embedder's page loses it. A run before that was understood read
// press=1 reach=0 with the element focused, which is exactly that.
document.addEventListener("domicile-guest-focus", (event) => {
  say(`window-reached target=${event.target.localName}`);
  if (document.activeElement === view) {
    say("window-active");
  }
});

// And the focus event that would have been the obvious way to hear it, kept as
// a reading rather than an assertion: if it ever starts arriving, the element's
// own event is no longer the only path and this page is where that shows up.
document.addEventListener("focusin", (event) => {
  say(`window-focusin target=${event.target.localName}`);
});

// THE SAME EVENT, HEARD AT THE ELEMENT. Two listeners for one event because
// their difference is a reading: the claim above is on the document, which the
// event only reaches by bubbling, and a run where this one fires and that one
// does not is a dispatch that happened and did not travel. A run where neither
// fires is a dispatch that did not happen. Without the pair those are one
// symptom, and the guard has already spent a cycle on a question of that shape.
view.addEventListener("domicile-guest-focus", () => {
  say("window-reached-at-element");
});

// And the harness's own reading: a press that landed in this document.
document.addEventListener("mousedown", (event) => {
  say(`chrome-mousedown target=${event.target.localName}`);
});

// Focus leaving this document entirely, which is what a guest taking it looks
// like from here — and the reading that says the browser told this renderer
// anything at all. `FocusController::SetFocusedFrame` dispatches it on the old
// frame's window, a dozen lines past where the fork's branch sits.
addEventListener("blur", () => {
  say("shell-window-blur");
});

addEventListener("focus", () => {
  say("shell-window-focus");
});

// And where focus actually is, reported whenever it moves. Polled rather than
// listened for, because the state this is about is the one no event announces:
// a document whose focus has gone to a page in another process.
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

// Last, and this is the order that matters: `src` is what makes a <webview>
// ask for a guest, and setting it before the element is in the document would
// ask before there is a frame to attach one to.
document.body.append(view);
view.setAttribute("src", required(parameters, "src"));

// NOTHING HERE FOCUSES THE ELEMENT, and that absence is the experiment. The
// shell does focus it — that is what `view.focus()` in `BrowserWindow.tsx` is
// — but a guard that did would be reporting its own call: the question is
// whether a press *inside the guest* reaches this document, with the shell
// doing nothing at all.
say("shell-loaded");
