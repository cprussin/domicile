// The shell guard-webview-context-menu.sh drives: one browser window showing a
// picture inside a link, plus the window DevTools opens in. A module, because
// only a domicile:// document may ask for a guest.
//
// Logs:
// - chrome-mousedown: a press in this document, so absences below mean
//   something.
// - context-menu: the menu, with what was under the click. Then runs
//   "inspect" on it.
// - new-window: the DevTools window "inspect" opens, from the desk's list.
//   Drawn as a shell would.
//
// The document Domicile writes calls `Shell` once the module loads.

export const Shell = () => {
  const required = (parameters, name) => {
    const value = parameters.get(name);
    if (value === null) {
      throw new Error(`guard-webview-context-menu: ?${name}= is required`);
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
  strip.style.blockSize = stripHeight;
  strip.style.background = "#204060";

  // Sized rather than stretched between insets: see guard-webview-routed-link.js.
  const view = document.createElement("webview");
  view.style.position = "absolute";
  view.style.insetBlockStart = stripHeight;
  view.style.insetInline = "0";
  view.style.inlineSize = "100%";
  view.style.blockSize = `calc(100% - ${stripHeight})`;
  view.style.border = "0";

  document.addEventListener("mousedown", (event) => {
    say(`chrome-mousedown target=${event.target.localName}`);
  });

  view.addEventListener("domicile-context-menu", (event) => {
    say(
      `context-menu link=${event.linkUrl} src=${event.srcUrl} media=${event.mediaType} pixels=${event.hasImageContents} x=${event.x} y=${event.y}`,
    );
    event.run("inspect");
  });

  // DevTools' window, which the desk opens and the shell draws. Behind the
  // first, so the press point stays on the page.
  const host = navigator.domicile;
  if (host === undefined) {
    throw new Error(
      "guard-webview-context-menu: navigator.domicile is absent, so this" +
        " document is not a shell the engine serves",
    );
  }
  const drawn = new Set();
  host.addEventListener("browserwindowschanged", () => {
    for (const window of host.browserWindows ?? []) {
      if (!drawn.has(window.id)) {
        drawn.add(window.id);
        say(`new-window url=${window.url}`);
        const tools = document.createElement("webview");
        tools.style.position = "absolute";
        tools.style.inset = "0";
        tools.style.inlineSize = "100%";
        tools.style.blockSize = "100%";
        tools.style.zIndex = "-1";
        tools.setAttribute("window", window.id);
        document.body.append(tools);
      }
    }
  });

  document.body.style.margin = "0";
  document.body.append(strip);
  document.body.append(view);
  view.setAttribute("src", required(parameters, "src"));

  say("shell-loaded");
};
