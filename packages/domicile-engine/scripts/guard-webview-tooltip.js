// The shell module guard-webview-tooltip.sh loads: one <webview> under a strip
// of shell UI.
//
// - It must be served from domicile:// because the browser binds
//   WebViewGuestHost only for the shell's origin.
// - It logs pointer moves on its own strip, so a missing reading later means
//   something: without one, no move reached this browser.
// - It logs each `domicile-tooltip-change` with the element's tooltip, where
//   it is, and when, so the guard can check both the place and the delay.

export const HostShell = () => {
  /**
   * Reads a required query parameter. Throws when missing: a default would
   * measure a setup the guard did not ask for.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-tooltip: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);

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

  strip.addEventListener("mousemove", () => {
    say("chrome-mousemove");
  });

  // The claim. The time is the wall clock's, which the guard also reads.
  document.addEventListener("domicile-tooltip-change", () => {
    say(
      `tooltip text=[${view.tooltip}] x=${view.tooltipX} y=${view.tooltipY} at=${Date.now()}`,
    );
  });

  document.body.style.margin = "0";
  document.body.append(strip);

  // `src` after insertion: before it there is no frame to attach a guest to.
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
