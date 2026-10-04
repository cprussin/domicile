// The shell guard-extension-tray.sh drives: a page that listens for the tray,
// and opens one <webview>.
//
// WHAT THIS PAGE SAYS, all of it to the console, which the engine writes to its
// own log:
//
//   GUARD listening              navigator.domicile exists and a listener is
//                                registered -- the harness working, and what
//                                tells "nothing arrived" from "this never ran"
//   GUARD extensions count=…     an `extensions` event arrived, and how many
//                                rows it had. The control's reading that its
//                                absence is an answer
//   GUARD tray id=… title=… badge=… color=… popup=… icon=… enabled=…
//                                the row for `?expect=`, each time one arrives.
//                                THE CLAIM about the tray
//   GUARD page url=…             the <webview> is showing a page, and where
//   GUARD size width=… height=… url=…
//                                the <webview> dispatched
//                                `domicile-content-size-change`, and the size
//                                it holds. THE CLAIM about the size
//   GUARD closed url=…           the <webview> dispatched `domicile-close`.
//                                THE CLAIM about the close
//
// WHAT IT OPENS. `?open=popup` is the claim: the popup the `expect` row names,
// once a row names one -- so the address opened is the one the tray reported.
// Anything else is an address, opened as soon as any `extensions` event
// arrives: the control's page, which never calls window.close().
//
// Everything is inside `Shell`, which the document Domicile writes calls once
// the module has loaded.

export const Shell = () => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  /**
   * A query parameter this cannot run without. A default would turn a guard
   * invoked wrongly into a measurement of something nobody asked for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-extension-tray: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const host = navigator.domicile;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-extension-tray: navigator.domicile is absent, so this document" +
        " was not served by the forked engine",
    );
  }

  const parameters = new URLSearchParams(location.search);
  const expected = required(parameters, "expect");
  const open = required(parameters, "open");

  /**
   * The one <webview>, made the first time there is something to show: the
   * tray's popup marked `extensionpopup`, as a shell's tray marks it, or the
   * control's page as an ordinary browser window.
   */
  const show = (src, extensionPopup) => {
    const view = document.createElement("webview");
    if (extensionPopup) {
      view.setAttribute("extensionpopup", "");
    }
    view.style.position = "absolute";
    view.style.inset = "10%";
    view.style.border = "0";
    view.addEventListener("domicile-page-change", () => {
      say(`page url=${view.url}`);
    });
    view.addEventListener("domicile-content-size-change", () => {
      say(
        `size width=${view.contentWidth} height=${view.contentHeight}` +
          ` url=${view.url}`,
      );
    });
    view.addEventListener("domicile-close", () => {
      say(`closed url=${view.url}`);
      view.remove();
    });
    // `src` last: it is what asks for a guest, and the element needs a frame
    // first.
    document.body.append(view);
    view.setAttribute("src", src);
  };

  let opened = false;
  host.addEventListener("extensions", (event) => {
    say(`extensions count=${event.extensions.length}`);
    const row = event.extensions.find((extension) => extension.id === expected);
    if (row !== undefined) {
      say(
        `tray id=${row.id} title=${row.title} badge=${row.badgeText}` +
          ` color=${row.badgeColor} popup=${row.popup}` +
          ` icon=${row.icon.startsWith("data:image/png;base64,")}` +
          ` enabled=${row.enabled}`,
      );
    }
    const src = open === "popup" ? row?.popup : open;
    if (!opened && src !== undefined && src !== null) {
      opened = true;
      show(src, open === "popup");
    }
  });
  say("listening");
};
