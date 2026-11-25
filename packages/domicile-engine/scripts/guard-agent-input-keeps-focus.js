// The shell module guard-agent-input-keeps-focus.sh loads: the user's text
// field in a strip at the top, focused, and every browser window the desk
// lists in a `<webview window>` under it.
//
// The guard types into the browser window as an agent does, through
// `devtools <window>`, and asks whether the user's field kept the focus.
//
// Console lines, which the engine writes to its log:
//
//   GUARD shell-loaded           this module ran, and the field has focus
//   GUARD window id=…            a browser window was drawn
//   GUARD user-input value=…     something typed into the user's field
//   GUARD window-reached         a browser window's page took the focus
//                                (`domicile-guest-focus`), which is what a
//                                shell raises and focuses a window on
//   GUARD focusin target=…       an ordinary focus event in this document
//   GUARD active=…               what the shell's activeElement became, by id
//                                or tag, at load and after each change. The
//                                command socket's devtools gives agents no
//                                Runtime.evaluate, so the guard reads this.
//
// The engine's document calls `HostShell` once the module loads.

export const HostShell = (root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  const parameters = new URLSearchParams(location.search);
  const strip = parameters.get("strip");
  if (strip === null) {
    throw new Error("guard-agent-input-keeps-focus: ?strip= is required");
  }

  // Where the user is typing.
  const field = document.createElement("input");
  field.id = "user";
  field.setAttribute("aria-label", "the user's field");
  field.style.position = "absolute";
  field.style.insetBlockStart = "0";
  field.style.insetInline = "0";
  field.style.blockSize = `${strip}px`;
  field.addEventListener("input", () => {
    say(`user-input value=${field.value}`);
  });
  root.append(field);

  document.addEventListener("domicile-guest-focus", () => {
    say("window-reached");
  });
  document.addEventListener("focusin", (event) => {
    say(`focusin target=${event.target.localName}`);
  });

  const drawn = new Set();
  desktop.addEventListener("browserwindowschanged", () => {
    for (const window of desktop.browserWindows ?? []) {
      if (!drawn.has(window.id)) {
        drawn.add(window.id);
        // An explicit size: a replaced element with `auto` size takes its
        // intrinsic 300x150. `window` is set before attaching, since the
        // element reads it once, on asking for a guest.
        const view = document.createElement("webview");
        view.style.position = "absolute";
        view.style.insetBlockStart = `${strip}px`;
        view.style.insetInlineStart = "0";
        view.style.inlineSize = "100%";
        view.style.blockSize = `calc(100% - ${strip}px)`;
        view.style.border = "0";
        view.setAttribute("window", window.id);
        root.append(view);
        say(`window id=${window.id}`);
      }
    }
  });

  field.focus();
  let active = "";
  const sayActive = () => {
    const now =
      document.activeElement?.id || document.activeElement?.localName || "none";
    if (now !== active) {
      active = now;
      say(`active=${now}`);
    }
  };
  sayActive();
  setInterval(sayActive, 100);
  say("shell-loaded");
};
