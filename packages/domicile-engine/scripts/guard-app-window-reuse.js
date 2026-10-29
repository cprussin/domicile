// The shell module guard-app-window-reuse.sh loads. It draws every browser
// window the desk lists in a `<webview window>`, and logs how many app windows
// each app id has, the oldest `mail` window's address, and each focus request.
// The guard opens the `mail` windows through the engine's command socket, as
// `domicile open --app --id` does. This module opens `<site>/chat` itself,
// twice in a row, with openAppWindow's `reuse` from the address's `reuse`, and
// counts the chat window's items with countBrowserWindowMatches.
//
// Console output, which the engine writes to its log:
//
//   GUARD shell-loaded                  this module ran
//   GUARD list mail=… chat=… mail-id=… mail-url=…
//                                       the app windows, on every change
//   GUARD focus app=…                   a <webview> asked to be in front
//   GUARD count=…                       the chat window's `p.item`s
//   GUARD count-failed …                countBrowserWindowMatches rejected
//
// The engine's document calls `HostShell` once the module loads.

export const HostShell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  /** The app id each drawn window's <webview> shows, by element. */
  const appOf = new Map();

  /**
   * A <webview window> with an explicit size: a replaced element with `auto`
   * size takes its intrinsic 300x150. `window` is set before attaching, since
   * the element reads it once, on asking for a guest.
   */
  const draw = (window) => {
    const view = document.createElement("webview");
    view.style.inlineSize = "320px";
    view.style.blockSize = "200px";
    view.setAttribute("window", window.id);
    appOf.set(view, window.appId);
    document.body.append(view);
  };

  // On the document, since the event bubbles; `app=` names the source.
  document.addEventListener("domicile-focus-request", (event) => {
    say(`focus app=${appOf.get(event.target) ?? "none"}`);
  });

  const drawn = new Set();
  let counted = false;
  let last = "";
  desktop.addEventListener("browserwindowschanged", () => {
    const windows = desktop.browserWindows ?? [];
    for (const window of windows) {
      if (!drawn.has(window.id)) {
        drawn.add(window.id);
        draw(window);
      }
    }
    const mail = windows.filter((window) => window.appId === "mail");
    const chat = windows.filter((window) => window.appId === "chat");
    const line = `list mail=${mail.length} chat=${chat.length} mail-id=${mail[0]?.id ?? ""} mail-url=${mail[0]?.url ?? ""}`;
    if (line !== last) {
      last = line;
      say(line);
    }
    // Once its page has its title, so it has loaded its items.
    if (!counted && chat[0]?.title === "chat") {
      counted = true;
      desktop.countBrowserWindowMatches(chat[0].id, "p.item").then(
        (count) => {
          say(`count=${count}`);
        },
        (failure) => {
          say(`count-failed ${failure}`);
        },
      );
    }
  });

  say("shell-loaded");

  const query = new URLSearchParams(location.search);
  const chat = `${query.get("site")}/chat`;
  const reuse = query.get("reuse");
  desktop.openAppWindow(chat, "chat", reuse);
  desktop.openAppWindow(chat, "chat", reuse);
};
