// The shell module guard-webview-target-url.sh loads: one browser window under
// a strip of shell UI. The window's page is one link.
//
// - A shell is a module the engine loads into its own document (see
//   ShellURLLoaderFactory::ShellDocument), so the guard ships a module, not
//   HTML.
// - It must be served from domicile:// because the browser binds
//   WebViewGuestHost only for the shell's origin.
// - It logs pointer moves on its own strip, so a missing reading later means
//   something: without one, no move reached this browser.
// - It logs each `domicile-target-url-change` with the element's `targetUrl`
//   in brackets, so an empty one reads `url=[]`.

export const Shell = () => {
  /**
   * Reads a required query parameter. Throws when missing: a default would
   * measure a setup the guard did not ask for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-target-url: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);

  // The shell's strip above the <webview>. The guard's first move lands here.
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

  // Shows the harness can deliver a move to this document.
  strip.addEventListener("mousemove", () => {
    say("chrome-mousemove");
  });

  // The claim. Listened for on the document because shells rely on it
  // bubbling.
  document.addEventListener("domicile-target-url-change", () => {
    say(`target-url url=[${view.targetUrl}]`);
  });

  document.body.style.margin = "0";
  document.body.append(strip);

  // Set `src` after the element is in the document. `src` makes the <webview>
  // ask for a guest, and before insertion there is no frame to attach it to.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
