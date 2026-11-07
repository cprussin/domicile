// The shell module guard-webview-resend-form.sh loads: one browser window
// under a strip of shell UI. The window's pages are
// guard-webview-resend-form-server.py's.
//
// - A shell is a module the engine loads into its own document (see
//   ShellURLLoaderFactory::ShellDocument), so the guard ships a module, not
//   HTML.
// - Once the page the form posted to has loaded, it reloads it once, as the
//   shell's reload button does, which would send the form again.
// - It answers each `domicile-prompt` as ?prompt= says (accept or dismiss),
//   and logs it.

export const HostShell = () => {
  /**
   * Reads a required query parameter. Throws when missing: a default would
   * measure a setup the guard did not ask for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-resend-form: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);
  const prompt = required(parameters, "prompt");

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

  // Reloads once, when the posted page has finished loading.
  let reloaded = false;
  document.addEventListener("domicile-loading-change", () => {
    if (!reloaded && !view.loading && view.url.endsWith("/posted")) {
      reloaded = true;
      say("reloading");
      view.reload();
    }
  });

  // Listened for on the document because shells rely on it bubbling.
  // Claimed in both runs, so the control differs only in the answer.
  document.addEventListener("domicile-prompt", (event) => {
    say(
      `prompt kind=${event.kind} origin=${event.origin} subject=${event.subject}`,
    );
    event.preventDefault();
    if (prompt === "accept") {
      event.accept();
    } else if (prompt === "dismiss") {
      event.dismiss();
    } else {
      throw new Error(
        `guard-webview-resend-form: ?prompt=${prompt} is not one`,
      );
    }
    say("prompt-answered");
  });

  document.body.style.margin = "0";
  document.body.append(strip);

  // Set `src` after the element is in the document. `src` makes the <webview>
  // ask for a guest, and before insertion there is no frame to attach it to.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
