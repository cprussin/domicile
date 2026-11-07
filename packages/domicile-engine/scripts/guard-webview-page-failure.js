// The shell module guard-webview-page-failure.sh loads: one browser window
// under a strip of shell UI. The window's pages are
// guard-webview-page-failure-server.py's.
//
// - A shell is a module the engine loads into its own document (see
//   ShellURLLoaderFactory::ShellDocument), so the guard ships a module, not
//   HTML.
// - It logs each `domicile-page-failure-change` with what the element says,
//   and walks the window through ?src=, then ?then=, then ?last=: each
//   failure moves it to the next page.

export const HostShell = () => {
  /**
   * Reads a required query parameter. Throws when missing: a default would
   * measure a setup the guard did not ask for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-page-failure: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);
  // The pages after the first, in order. Empty in the control.
  const next = [parameters.get("then"), parameters.get("last")].filter(
    (page) => page !== null,
  );

  const stripHeight = `${required(parameters, "strip")}px`;
  const strip = document.createElement("div");
  strip.style.position = "absolute";
  strip.style.insetBlockStart = "0";
  strip.style.insetInline = "0";
  strip.style.inlineSize = "100%";
  strip.style.blockSize = stripHeight;
  strip.style.background = "#204060";

  // Sized rather than stretched between insets: see
  // guard-webview-routed-link.js.
  const view = document.createElement("webview");
  view.style.position = "absolute";
  view.style.insetBlockStart = stripHeight;
  view.style.insetInline = "0";
  view.style.inlineSize = "100%";
  view.style.blockSize = `calc(100% - ${stripHeight})`;
  view.style.border = "0";

  // Listened for on the document because shells rely on it bubbling.
  document.addEventListener("domicile-page-failure-change", () => {
    say(
      `failure kind=${view.pageFailure} error=${view.pageFailureError} status=${view.pageFailureHttpStatus} proceed=${view.pageFailureCanProceed} url=${view.pageFailureUrl}`,
    );
    const page = view.pageFailure === "" ? undefined : next.shift();
    if (page !== undefined) {
      view.setAttribute("src", page);
    }
  });

  document.body.style.margin = "0";
  document.body.append(strip);

  // Set `src` after the element is in the document. `src` makes the <webview>
  // ask for a guest, and before insertion there is no frame to attach it to.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
