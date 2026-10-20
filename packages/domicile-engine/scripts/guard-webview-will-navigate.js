// The shell module guard-webview-will-navigate.sh loads: one <webview> on
// guard-webview-will-navigate-server.py's /start, whose page navigates itself
// to /blocked and then /allowed. The shell cancels /blocked on
// `domicile-will-navigate`, unless `cancel=0` (the control). Once the page is
// past /start, the shell sets `src` to /shell-set, which must not ask.
//
// It must be a domicile:// document: the browser binds WebViewGuestHost only
// for the shell's origin.
//
// Console output, which the engine writes to its log:
//
//   GUARD shell-loaded                  this module ran
//   GUARD will-navigate path=…          the element asked about a navigation
//   GUARD page path=…                   the page the element reports
//   GUARD done                          a second after /shell-set showed
//
// The engine's document calls `Shell` once the module loads.

// Time after /shell-set for a late `domicile-will-navigate` to arrive.
const LATE_MS = 1000;

export const Shell = () => {
  /**
   * Reads a required query parameter. No default, so a misconfigured guard
   * fails instead of measuring the wrong thing.
   */
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-will-navigate: ?${name}= is required`);
    } else {
      return value;
    }
  };

  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);
  const site = required(parameters, "site");
  const cancel = required(parameters, "cancel") === "1";

  const view = document.createElement("webview");
  view.style.inlineSize = "320px";
  view.style.blockSize = "200px";

  // Before `src`, so no navigation goes unheard.
  view.addEventListener("domicile-will-navigate", (event) => {
    const path = new URL(event.url).pathname;
    say(`will-navigate path=${path}`);
    if (cancel && path === "/blocked") {
      event.preventDefault();
    }
  });

  let shellSet = false;
  view.addEventListener("domicile-page-change", () => {
    if (view.url !== "") {
      const path = new URL(view.url).pathname;
      say(`page path=${path}`);
      if (!shellSet && (path === "/allowed" || path === "/blocked")) {
        shellSet = true;
        view.src = `${site}/shell-set`;
      } else if (path === "/shell-set") {
        setTimeout(() => {
          say("done");
        }, LATE_MS);
      }
    }
  });

  document.body.append(view);
  view.src = `${site}/start`;
  say("shell-loaded");
};
