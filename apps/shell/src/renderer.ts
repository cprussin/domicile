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

const stage = document.getElementById("stage");
const clock = document.getElementById("clock");
if (stage === null || clock === null) {
  throw new Error("shell: index.html is missing #stage or #clock");
}

const bridge = new BridgeClient(transport);
const shell = new ShellController(bridge, { root: stage });
shell.installKeybindings(); // Alt+Enter -> kitty, Alt+Shift+Enter -> webview

installClock(clock);

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
