// The page, and the whole of this shell's behaviour.
//
// A shell is a web page that mounts `<domicile-app>` elements. Where they are
// and how big they are is the shell's entire job — this one puts every app
// full-screen with the newest on top, which is the least a shell can do and
// still be one. Everything else a desktop has is CSS and event handlers on top
// of exactly this.

import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";
import { reportDevicePixelRatio } from "@domicile/chrome-sdk/device-pixel-ratio";
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

// One call, two places. Under the engine this is `navigator.domicile`, the
// control channel on a document the fork served; in an ordinary browser there
// is none, and `connectToHost` says so on the console and hands back a
// stand-in — which is worth keeping possible, because the layout can be worked
// on without a compositor, against apps that will never arrive.
const domicile = new DomicileClient(connectToHost(navigator));
// Defines `<domicile-app>`, bound to this client.
// Until this runs the tags are unknown elements and mount nothing.
registerElements(domicile);

/** Every app the host has announced, by the id it announced it under. */
const mounted = new Map<string, HTMLElement>();

domicile.on("app_appeared", ({ app_id }) => {
  const element = document.createElement("domicile-app");
  element.setAttribute("app-id", app_id);
  // Appending is what puts it on top: the elements are absolutely positioned
  // and share a stacking context, so document order is the stack.
  document.body.append(element);
  mounted.set(app_id, element);
});

domicile.on("app_closed", ({ app_id }) => {
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

// The ratio changes when the window moves display or the page zooms, and the
// page is the only part of Domicile that can see either. Sent straight away:
// there is no handshake to wait for, and the first call is what binds the
// channel.
reportDevicePixelRatio(domicile, window);
