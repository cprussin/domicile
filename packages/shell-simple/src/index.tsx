// Entry point: `Shell` connects the SDK to the host and mounts the React
// desktop. Importing this module only installs its stylesheet.

import { connectToHost } from "@domicile-desktop/sdk/connect-to-host";
import { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import { registerElements } from "@domicile-desktop/sdk/register-elements";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";
import { createRoot } from "react-dom/client";

import { Shell as Desktop } from "./Shell";

import "./shell.css";

/** The simple desktop, mounted into `root`. */
export const Shell: ShellModule = (root) => {
  // Under the fork this is `window.domicile`, the engine's control channel. In
  // a plain browser `connectToHost` logs a warning and returns a stub, so the
  // desktop still opens.
  const domicile = new DomicileClient(connectToHost(window));
  registerElements(domicile);

  // Mount in a separate container: the document appends failure reports to
  // `root`, and a React root there would erase them.
  const mount = document.createElement("div");
  root.append(mount);
  createRoot(mount).render(<Desktop domicile={domicile} />);
};
