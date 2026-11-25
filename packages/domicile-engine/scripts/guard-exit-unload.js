// The shell for guard-exit-unload.sh. It opens a browser window at each address
// in `?lock=` and `?hung=`, and draws each in a <webview>. It logs to the
// console, which the engine writes to its log:
//
//   GUARD shell-loaded   this module ran
//
// The pages log too (guard-exit-unload-server.py).
//
// Everything is inside `HostShell`, which Domicile's document calls once the
// module loads.

export const HostShell = (_root, host) => {
  const parameters = new URLSearchParams(location.search);
  const addresses = ["lock", "hung"].map((name) => {
    const address = parameters.get(name);
    if (address === null) {
      throw new Error(`guard-exit-unload: ?${name}= is required`);
    } else {
      return address;
    }
  });

  // `window` is set before the element enters the document, when it asks for
  // its page.
  const draw = (id) => {
    const view = document.createElement("webview");
    view.style.inlineSize = "50%";
    view.style.blockSize = "50%";
    view.setAttribute("window", id);
    document.body.append(view);
  };

  const drawn = new Set();
  let opened = false;
  host.addEventListener("browserwindowschanged", () => {
    if (!opened) {
      opened = true;
      for (const address of addresses) {
        host.openBrowserWindow(address);
      }
    }
    for (const { id } of host.browserWindows ?? []) {
      if (!drawn.has(id)) {
        drawn.add(id);
        draw(id);
      }
    }
  });

  console.log("GUARD shell-loaded");
};
