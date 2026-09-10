// The shell guard-webview-keyboard.sh drives: one browser window, holding the
// keyboard, with a desktop chord claimed over it.
//
// A module rather than a page, because that is what a shell is here — the
// engine writes the document and loads exactly one module into it, so a guard
// that shipped its own HTML would be running a configuration the product does
// not have. See ShellURLLoaderFactory::ShellDocument. It has to be a
// domicile:// document for two further reasons: the browser binds
// WebViewGuestHost only for the shell's origin, so a <webview> anywhere else
// cannot ask for a guest at all, and it binds the control channel the same way,
// so `navigator.domicile` exists on no other page.
//
// ?kind= is the experiment, exactly as it is in guard-webview-framing.js.
// `webview` puts a guest behind the element, which is what makes the browser
// process the layer above the focused page; `iframe` puts an ordinary subframe
// there, which takes the keyboard just as thoroughly and has no guest delegate
// behind it — so the chord must NOT fire, and that is the negative control.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to its
// own log:
//
//   GUARD claimed                 the chord was claimed, so a run where nothing
//                                 fires is not a run where nothing was asked
//   GUARD window-focused          the element is this document's activeElement,
//                                 so the keyboard has left the shell
//   GUARD shortcut keycode=…      a claimed chord came back up the control
//                                 channel. This is the whole claim of the guard
//   GUARD modifiers alt=…         the seat's modifiers, which the shell cannot
//                                 read off a DOM event while a window has the
//                                 keyboard — Alt-dragging a float is why
//   GUARD document-keydown code=… a key reached the SHELL's document. Over a
//                                 browser window this must not happen, and its
//                                 absence beside the guest page's own
//                                 `guest-keydown` is what says an unhandled
//                                 key stops at the window

/**
 * A query parameter this cannot run without. Missing means the guard invoked
 * this wrongly, and a default would turn that into a measurement of something
 * nobody asked for.
 */
const required = (parameters, name) => {
  const value = parameters.get(name);
  if (value === null) {
    throw new Error(`guard-webview-keyboard: ?${name}= is required`);
  } else {
    return value;
  }
};

/**
 * The element under test. Not `document.createElement(kind)` on whatever the
 * query said: an unknown tag would become an HTMLUnknownElement with no nested
 * context at all, and the run would report "no chord fired" about an element
 * that never took the keyboard in the first place.
 */
const buildView = (kind) => {
  switch (kind) {
    case "webview": {
      return document.createElement("webview");
    }
    case "iframe": {
      return document.createElement("iframe");
    }
    default: {
      throw new Error(
        `guard-webview-keyboard: ?kind= is "webview" or "iframe", got "${kind}"`,
      );
    }
  }
};

const say = (what) => {
  console.log(`GUARD ${what}`);
};

const parameters = new URLSearchParams(location.search);
const view = buildView(required(parameters, "kind"));

view.style.position = "absolute";
view.style.inset = "0";
view.style.inlineSize = "100%";
view.style.blockSize = "100%";
view.style.border = "0";

// The shell's own keyboard, which is one of the two paths this is about. It
// works today and keeps working over a `<domicile-app>`; over a browser window
// it hears nothing, because DOM focus has left this document entirely.
//
// AND IT IS ALSO THE CONTROL FOR THE OTHER HALF. "The shell did not see the
// key" means nothing unless this harness can deliver one here at all, so the
// guard presses a key BEFORE the window takes focus and this is what must
// report it. Taking the keyboard is therefore triggered by that keystroke
// rather than done at startup.
document.addEventListener("keydown", (event) => {
  say(`document-keydown code=${event.code} alt=${event.altKey}`);
  takeTheKeyboard();
});

// Alt+Tab, in the evdev codes the control channel speaks, and named the way
// `Shell.tsx` names it: every modifier, including the three that must not be
// held, because the match is on the whole combination.
const ALT_TAB = {
  altKey: true,
  ctrlKey: false,
  keycode: 15,
  metaKey: false,
  shiftKey: false,
};

const host = navigator.domicile;
if (host === null || host === undefined) {
  // Loud rather than a page that quietly measures nothing: without the control
  // channel there is no claim to make and no leg for a press to come back on,
  // and every assertion below would be absent for a reason that is not the one
  // the guard is asking about.
  throw new Error(
    "guard-webview-keyboard: navigator.domicile is absent, so this document" +
      " was not served by the forked engine",
  );
}

host.addEventListener("shortcut", (event) => {
  say(
    `shortcut keycode=${event.keycode} alt=${event.altKey}` +
      ` ctrl=${event.ctrlKey} shift=${event.shiftKey} meta=${event.metaKey}`,
  );
});

host.addEventListener("modifiers", (event) => {
  say(
    `modifiers alt=${event.altKey} ctrl=${event.ctrlKey}` +
      ` shift=${event.shiftKey} meta=${event.metaKey}`,
  );
});

host.grabShortcut(ALT_TAB);
say(`claimed keycode=${ALT_TAB.keycode}`);

// Last, and this is the order that matters: `src` is what makes a <webview> ask
// for a guest, and setting it before the element is in the document would ask
// before there is a frame to attach one to.
document.body.append(view);
view.setAttribute("src", required(parameters, "src"));

// AFTER THE FIRST KEYSTROKE, NOT AT STARTUP. Handing the window the keyboard
// is what `BrowserWindow.tsx` does when a browser window becomes the one the
// user is working in, and it is the thing under test — so it happens between
// the guard's two keystrokes, which is what makes the pair a before and an
// after rather than two readings of the same state.
//
// On an interval once it starts, because there is no moment here that is known
// to be after the guest exists: attaching is asynchronous, the element is told
// nothing when it finishes, and focusing an element whose page is not there yet
// moves nothing.
//
// `document.activeElement` is what says it landed, and it is asked HERE rather
// than answered by the page in the window. A page reports its own focus only
// when the browser's window is active, and this browser has no display for a
// window to be active on — so a run that waited on the far side would wait for
// ever on a keyboard that had in fact arrived. This document's own idea of
// where focus went does not depend on any of that, and it is exactly the state
// the shell puts the element in.
let announced = false;
let taking = false;
const takeTheKeyboard = () => {
  if (!taking) {
    taking = true;
    setInterval(() => {
      view.focus();
      if (!announced && document.activeElement === view) {
        announced = true;
        say("window-focused");
      }
    }, 200);
  }
};

// And on a timer as well, so that a harness which delivers no key events to
// this document at all still reaches the rest of the run. That run establishes
// less — the guard says so, in as many words — but establishing less is not the
// same as hanging, and the claims about the chord are not the ones that need a
// keystroke here.
setTimeout(takeTheKeyboard, 5000);
