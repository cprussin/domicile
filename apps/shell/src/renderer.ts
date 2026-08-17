// Entry point for the shell's renderer. The compositor loads the built
// index.html, injects a transport at `window.domicileTransport`, and this wires
// the SDK to it.

import { aliasTag } from "@domicile/chrome-sdk/alias-tags";
import { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { APP_TAG_NAME } from "@domicile/chrome-sdk/register-elements";

import { installClock } from "./clock";
import { ShellController } from "./shell-controller";
import "./style.css";

// The host exposes a transport (send/onMessage) to the page. Fall back to a
// no-op so the shell can be opened in a plain browser for styling work.
const transport = window.domicileTransport ?? {
  onMessage: () => undefined,
  send: () => undefined,
};

// The markup this entry point wires up is its own file, so a missing id is a
// mismatch between the two rather than a condition to handle. It is declared
// here, above its callers, because they run as the module loads.
const required = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`shell: index.html is missing #${id}`);
  } else {
    return element;
  }
};

const bridge = new BridgeClient(transport);
const shell = new ShellController(bridge, {
  root: required("stage"),
  tabs: required("tabs"),
});
shell.installKeybindings(); // Alt+Enter -> kitty, Alt+Shift+Enter -> a browser

required("launch-browser").addEventListener("click", () => {
  shell.openBrowser();
});
required("launch-terminal").addEventListener("click", () => {
  shell.openTerminal();
});

installClock(required("clock"));

// Let shell markup say `<app>`; the SDK registers the hyphenated name a custom
// element requires. `<webview>` keeps its long name — Electron owns that tag.
aliasTag(document.body, "app", APP_TAG_NAME);

// The compositor watches this attribute to know the chrome finished its
// handshake; a failed handshake must surface rather than leave it unset
// silently, so the rejection is rethrown out of the microtask.
bridge
  .connect()
  .then(() => {
    document.body.dataset.domicileConnected = "true";
  })
  .catch((error: unknown) => {
    throw new Error("domicile: bridge handshake failed", { cause: error });
  });
