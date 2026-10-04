// The shell module guard-webview-keyboard.sh loads: one browser window holding
// the keyboard, with a desktop chord claimed over it.
//
// It must be a domicile:// document: the browser binds WebViewGuestHost and
// the control channel only for the shell's origin. See
// ShellURLLoaderFactory::ShellDocument.
//
// ?kind= picks the element, as in guard-webview-framing.js. `webview` puts a
// guest behind it, so the browser process handles keys above the focused page.
// `iframe` is the negative control: it takes the keyboard but has no guest
// delegate, so the chord must not fire.
//
// Console output, which the engine writes to its log:
//
//   GUARD claimed                 the chord was claimed
//   GUARD window-focused          the element is this document's activeElement
//   GUARD shortcut keycode=…      a claimed chord came back up the control
//                                 channel
//   GUARD modifiers alt=…         the seat's modifiers, which the shell
//                                 cannot read from DOM events while a window
//                                 has the keyboard (needed to Alt-drag a float)
//   GUARD document-keydown code=… a key reached the shell's document. Must
//                                 not happen over a browser window
//   GUARD guest-chord key=…       a chord the guest page did not handle, sent
//                                 to the element as `domicile-guest-keydown`.
//                                 This is how a browser window's Ctrl+R
//                                 reaches the shell. A plain key must never
//                                 produce one
//   GUARD zoom factor=…           the zoom the browser reports after the first
//                                 guest chord set 150%
//
// The engine's document calls `Shell` once the module loads.

export const Shell = (_root, desktop) => {
  /**
   * Reads a required query parameter. No default, so a misconfigured guard
   * fails instead of measuring the wrong thing.
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
   * Creates the element under test. Rejects unknown kinds, which would become
   * an HTMLUnknownElement that never takes the keyboard.
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

  // The shell's own keyboard. Over a browser window it hears nothing, because
  // DOM focus has left this document.
  //
  // It also proves the harness can deliver keys here: the guard presses a key
  // before the window takes focus, and that keystroke triggers taking the
  // keyboard.
  document.addEventListener("keydown", (event) => {
    say(`document-keydown code=${event.code} alt=${event.altKey}`);
    takeTheKeyboard();
  });

  // Alt+Tab as evdev codes, as `Shell.tsx` names it. Lists every modifier
  // because the match is on the whole combination.
  const ALT_TAB = {
    altKey: true,
    ctrlKey: false,
    keycode: 15,
    metaKey: false,
    shiftKey: false,
  };

  const host = desktop;
  if (host === null || host === undefined) {
    // Without the control channel every reading below would be missing for an
    // unrelated reason, so fail loudly.
    throw new Error(
      "guard-webview-keyboard: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }

  host.addEventListener("shortcut", (event) => {
    say(
      `shortcut keycode=${event.keycode} alt=${event.altKey}` +
        ` ctrl=${event.ctrlKey} shift=${event.shiftKey} meta=${event.metaKey}`,
    );
  });

  host.addEventListener("modifierschanged", () => {
    say(
      `modifiers alt=${host.altKey} ctrl=${host.ctrlKey}` +
        ` shift=${host.shiftKey} meta=${host.metaKey}`,
    );
  });

  // A chord the guest page did not handle, returned by the guest's delegate.
  // The first one also zooms the page, so the run can check the zoom arrives.
  let zoomed = false;
  view.addEventListener("domicile-guest-keydown", (event) => {
    say(
      `guest-chord key=${event.key} code=${event.code} alt=${event.altKey}` +
        ` ctrl=${event.ctrlKey} shift=${event.shiftKey} meta=${event.metaKey}`,
    );
    if (!zoomed) {
      zoomed = true;
      view.setZoom(1.5);
    }
  });

  view.addEventListener("domicile-zoom-change", () => {
    say(`zoom factor=${view.zoom}`);
  });

  host.grabShortcut(ALT_TAB);
  say(`claimed keycode=${ALT_TAB.keycode}`);

  // Set `src` after attaching: it requests a guest, which needs a frame.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  // Focuses the window, as `BrowserWindow.tsx` does. Runs between the guard's
  // two keystrokes so they read before and after.
  //
  // Repeats on an interval: attaching is asynchronous and signals nothing, and
  // focusing an element before its page exists does nothing.
  //
  // Checks `document.activeElement` here, not focus in the guest page. A page
  // reports focus only when the browser window is active, and headless has no
  // display to make it active.
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

  // Also on a timer, so a harness that delivers no keys to this document still
  // finishes the run. The guard reports that run as weaker.
  setTimeout(takeTheKeyboard, 5000);
};
