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
// - closing-inspected: a press on the strip once DevTools' window is open
//   closes the window DevTools inspects.
// - windows-closed: both windows left the desk's list.
//
// The document Domicile writes calls `Shell` once the module loads.

export const Shell = (_root, desktop) => {
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

  // The inspected window's id, and DevTools' once it opens.
  let inspected;
  let tools;

  document.addEventListener("mousedown", (event) => {
    say(`chrome-mousedown target=${event.target.localName}`);
    if (tools !== undefined) {
      say("closing-inspected");
      desktop.closeBrowserWindow(inspected);
    }
  });

  view.addEventListener("domicile-context-menu", (event) => {
    say(
      `context-menu link=${event.linkUrl} src=${event.srcUrl} media=${event.mediaType} pixels=${event.hasImageContents} x=${event.x} y=${event.y}`,
    );
    event.run("inspect");
  });

  // The page is a browser window, so closing it destroys its page in the
  // desk's DeskWindows::Reap, with DevTools attached. DevTools' window is the
  // second, drawn behind the first so the press point stays on the page.
  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-webview-context-menu: no desktop was handed to Shell, so this" +
        " document is not a shell the engine serves",
    );
  }
  host.addEventListener("browserwindowschanged", () => {
    const windows = host.browserWindows ?? [];
    if (inspected === undefined && windows.length > 0) {
      inspected = windows[0].id;
      view.setAttribute("window", inspected);
      document.body.append(view);
    } else if (tools === undefined && windows.length > 1) {
      const window = windows[1];
      tools = window.id;
      say(`new-window url=${window.url}`);
      const drawn = document.createElement("webview");
      drawn.style.position = "absolute";
      drawn.style.inset = "0";
      drawn.style.inlineSize = "100%";
      drawn.style.blockSize = "100%";
      drawn.style.zIndex = "-1";
      drawn.setAttribute("window", tools);
      document.body.append(drawn);
    } else if (tools !== undefined && windows.length === 0) {
      say("windows-closed");
    }
  });

  document.body.style.margin = "0";
  document.body.append(strip);
  host.openBrowserWindow(required(parameters, "src"));

  say("shell-loaded");
};
