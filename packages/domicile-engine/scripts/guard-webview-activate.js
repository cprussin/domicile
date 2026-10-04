// The shell guard-webview-activate.sh runs: one browser window, logging when
// it fires `domicile-focus-request`.
//
// Logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded             the module ran
//   GUARD focus-request target=…   the request reached this document, and from
//                                  which element

export const Shell = () => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const src = new URLSearchParams(location.search).get("src");
  if (src === null) {
    throw new Error("guard-webview-activate: ?src= is required");
  } else {
    // On the document, since the event bubbles; `target=` names the source.
    document.addEventListener("domicile-focus-request", (event) => {
      say(`focus-request target=${event.target.localName}`);
    });

    const view = document.createElement("webview");
    view.style.position = "absolute";
    view.style.inset = "0";
    view.style.border = "0";
    // Appended before `src` is set, as guard-webview-framing.js does.
    document.body.append(view);
    view.setAttribute("src", src);

    say("shell-loaded");
  }
};
