// The shell guard-extension-installer.sh drives: one <webview>, showing one
// page, on the witness color -- guard-webview-content-script.js with two
// differences, both because the extension arrives while the page is up.
//
// It binds the control channel, because the list the installer is handed
// arrives on it, and registering a listener is what binds it (see
// DomicileHost::AddedEventListener). And it reloads the <webview> every
// second, because a content script runs in a page loaded AFTER its extension
// is installed, and the install is asynchronous: nothing tells this page when
// it is done, so it asks again until the guard has its answer.
//
// Everything is inside `Shell`, which the document Domicile writes calls once
// the module has loaded.

export const Shell = (_root, desktop) => {
  /**
   * A query parameter this cannot run without. A default would turn a guard
   * invoked wrongly into a measurement of something nobody asked for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-extension-installer: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const RELOAD_EVERY_MS = 1000;

  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-extension-installer: no desktop was handed to Shell, so this" +
        " document was not served by the forked engine",
    );
  }
  host.addEventListener("displayschanged", () => {
    /* only here to bind the channel */
  });
  console.log("GUARD listening");

  const parameters = new URLSearchParams(location.search);
  const view = document.createElement("webview");

  // Inset on the witness, in whole percentages, as guard-webview-content-script.js.
  view.style.position = "absolute";
  view.style.left = "10%";
  view.style.top = "10%";
  view.style.width = "80%";
  view.style.height = "70%";
  view.style.border = "0";

  document.body.style.background = `#${required(parameters, "witness")}`;

  // `src` last: it is what asks for a guest, and the element needs a frame first.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));
  setInterval(() => {
    view.reload();
  }, RELOAD_EVERY_MS);
};
