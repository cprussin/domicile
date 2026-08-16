// Entry point for the simple shell. The compositor loads index.html, injects a
// transport at `window.domicileTransport`, and this wires the SDK to it.

import { BridgeClient } from "@domicile/chrome-sdk";
import { ShellController } from "./src/shell.js";

// The host exposes a transport (send/onMessage) to the page. Fall back to a
// no-op so the shell can be opened in a plain browser for styling work.
const transport =
  window.domicileTransport ?? {
    send() {},
    onMessage() {},
  };

const bridge = new BridgeClient(transport);
const shell = new ShellController(bridge, { root: document.getElementById("stage") });
shell.installKeybindings(); // Alt+Enter -> kitty, Alt+Shift+Enter -> Google webview

bridge
  .connect()
  .then(() => {
    document.body.dataset.domicileConnected = "true";
  })
  .catch((err) => {
    console.error("domicile: bridge handshake failed", err);
  });

// A tiny bit of live chrome to prove CSS/JS work.
const clock = document.getElementById("clock");
const tick = () => {
  clock.textContent = new Date().toLocaleTimeString();
};
setInterval(tick, 1000);
tick();
