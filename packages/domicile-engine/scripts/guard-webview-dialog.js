// The shell module guard-webview-dialog.sh loads: one browser window
// under a strip of shell UI. The window's page is
// guard-webview-dialog-server.py's.
//
// - A shell is a module the engine loads into its own document (see
//   ShellURLLoaderFactory::ShellDocument), so the guard ships a module, not
//   HTML.
// - It must be served from domicile:// because the browser binds
//   WebViewGuestHost only for the shell's origin.
// - It logs presses on its own strip, so a missing reading later means
//   something: without one, no press reached this browser.
// - It logs each `domicile-dialog` with what it carries, then accepts it at
//   once with text other than the prompt's default, so the page's reading
//   shows the shell's answer rather than the default.

export const HostShell = () => {
  /**
   * Reads a required query parameter. Throws when missing: a default would
   * measure a setup the guard did not ask for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-dialog: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);

  // The shell's strip above the <webview>. The guard's first press lands here.
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

  // Shows the harness can deliver a press to this document.
  strip.addEventListener("mousedown", () => {
    say("chrome-mousedown");
  });

  // The claim. Listened for on the document because shells rely on it
  // bubbling.
  document.addEventListener("domicile-dialog", (event) => {
    event.preventDefault();
    say(
      `dialog type=${event.dialogType} message=${event.message} default=${event.defaultValue}`,
    );
    event.accept("Grace");
    say("dialog-answered");
  });

  document.body.style.margin = "0";
  document.body.append(strip);

  // Set `src` after the element is in the document. `src` makes the <webview>
  // ask for a guest, and before insertion there is no frame to attach it to.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
