// The shell's entry point: `Shell`, which wires the SDK to whatever host this
// page was opened under and mounts the React desktop on top of it. Importing
// this module does nothing but install its stylesheet.

import { connectToHost } from "@domicile-desktop/sdk/connect-to-host";
import { reportDesktopSize } from "@domicile-desktop/sdk/desktop-size";
import { reportDevicePixelRatio } from "@domicile-desktop/sdk/device-pixel-ratio";
import { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import { registerElements } from "@domicile-desktop/sdk/register-elements";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";
import { createRoot } from "react-dom/client";

import { Shell as Desktop } from "./Shell";

import "./shell.css";

/** The simple desktop, mounted into `root`. */
export const Shell: ShellModule = (root) => {
  // Under the fork this is `window.domicile`, the control channel the engine
  // puts on a document it served. In a plain browser there is none, and
  // `connectToHost` says so on the console and hands back a stand-in, so the
  // desktop still opens against windows that will never arrive.
  const domicile = new DomicileClient(connectToHost(window));
  registerElements(domicile);

  // A container of our own: the document reports a failure by appending to
  // `root`, and a React root that owned it would wipe the report.
  const mount = document.createElement("div");
  root.append(mount);
  createRoot(mount).render(<Desktop domicile={domicile} />);

  // The density is what a client renders at; the size is how big the desktop
  // *is*, and under the forked engine the compositor cannot see the window this
  // page is in — without the second call the desktop stays at the compositor's
  // startup placeholder however large the window really is.
  reportDevicePixelRatio(domicile, window);
  reportDesktopSize(domicile, window);
};
