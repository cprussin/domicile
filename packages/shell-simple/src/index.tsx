// The shell's entry point: `Shell`, which wires the SDK to the desktop this
// page was opened in and mounts the React desktop on top of it. Importing
// this module does nothing but install its stylesheet.

import { registerElements } from "@domicile-desktop/sdk/register-elements";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";
import { createRoot } from "react-dom/client";

import { Shell as Desktop } from "./Shell";

import "./shell.css";

/** The simple desktop, mounted into `root`. */
export const Shell: ShellModule = (root) => {
  // The desktop, as the engine puts it on a document it served. A plain
  // browser has none, and there is nothing to draw.
  const domicile = window.domicile;
  if (domicile === null || domicile === undefined) {
    return;
  }
  registerElements(domicile);

  // A container of our own: the document reports a failure by appending to
  // `root`, and a React root that owned it would wipe the report.
  const mount = document.createElement("div");
  root.append(mount);
  createRoot(mount).render(<Desktop domicile={domicile} />);
};
