// Entry point: `Shell` takes the desktop and mounts the React desktop.
// Importing this module only installs its stylesheet.

import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";
import { createRoot } from "react-dom/client";

import { Shell as Desktop } from "./Shell";

import "./shell.css";

/** The simple desktop, mounted into `root`. */
export const Shell: ShellModule = (root, domicile) => {
  // Mount in a separate container: the document appends failure reports to
  // `root`, and a React root there would erase them.
  const mount = document.createElement("div");
  root.append(mount);
  createRoot(mount).render(<Desktop domicile={domicile} />);
};
