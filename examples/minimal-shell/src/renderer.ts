// The page, and the whole of this shell's behaviour.
//
// A shell is a web page that mounts `<domicile-app>` elements. Where they are
// and how big they are is the shell's entire job — this one puts every app
// full-screen with the newest on top, which is the least a shell can do and
// still be one. Everything else a desktop has is CSS and event handlers on top
// of exactly this.

import {
  BridgeClient,
  describeHandshakeFailure,
} from "@domicile/chrome-sdk/bridge";
import { reportDevicePixelRatio } from "@domicile/chrome-sdk/device-pixel-ratio";
import { postedTransport } from "@domicile/chrome-sdk/host-transport";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

// What the preload exposed. Absent when the page is opened in an ordinary
// browser, which is worth keeping possible: the layout can be worked on without
// a compositor, against apps that will never arrive.
const host = window.domicileHost;
const transport =
  host === undefined
    ? { onMessage: () => undefined, send: () => undefined }
    : postedTransport(window, host);

const bridge = new BridgeClient(transport);
// Defines `<domicile-app>` and `<domicile-webview>`, bound to this bridge.
// Until this runs the tags are unknown elements and mount nothing.
registerElements(bridge);

/** Every app the host has announced, by the id it announced it under. */
const mounted = new Map<string, HTMLElement>();

bridge.on("app_appeared", ({ app_id }) => {
  const element = document.createElement("domicile-app");
  element.setAttribute("app-id", app_id);
  // Appending is what puts it on top: the elements are absolutely positioned
  // and share a stacking context, so document order is the stack.
  document.body.append(element);
  mounted.set(app_id, element);
});

bridge.on("app_closed", ({ app_id }) => {
  const element = mounted.get(app_id);
  if (element === undefined) {
    // Not a case to shrug off: the host announces every app before it closes
    // it, so a close for one that was never announced means this shell and the
    // compositor disagree about what is on the desktop. Everything after that
    // point is guesswork, and a shell that carried on would leak an element per
    // occurrence with nothing said.
    throw new Error(`domicile: closed an app that was never opened: ${app_id}`);
  } else {
    element.remove();
    mounted.delete(app_id);
  }
});

// The handshake's failure is a value rather than a throw: a version mismatch is
// the compositor and this shell having been built against different protocols,
// and both numbers are the message.
bridge
  .connect()
  .then((agreed) => {
    agreed.match({
      Err: (failure) => {
        // biome-ignore lint/suspicious/noConsole: the desktop has not started
        console.error(`domicile: ${describeHandshakeFailure(failure)}`);
      },
      Ok: () => {
        // After the handshake — the host ignores anything sent before it. The
        // ratio changes when the window moves display or the page zooms, and
        // the page is the only part of Domicile that can see either.
        reportDevicePixelRatio(bridge, window);
      },
    });
  })
  .catch((failure: unknown) => {
    // biome-ignore lint/suspicious/noConsole: the desktop has not started
    console.error("domicile: the handshake could not be completed", failure);
  });
