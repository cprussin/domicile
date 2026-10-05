// The shell's entry point: `Shell`, which mounts the React desktop on the
// desktop this page was opened in. Importing this module does nothing but
// install its stylesheet.

import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";
import { createRoot } from "react-dom/client";

import { Shell as Desktop } from "./Shell";

import "./shell.css";

/** The simple desktop, mounted into `root`. */
export const Shell: ShellModule = (root, domicile) => {
  // A container of our own: the document reports a failure by appending to
  // `root`, and a React root that owned it would wipe the report.
  const mount = document.createElement("div");
  root.append(mount);
  createRoot(mount).render(<Desktop domicile={domicile} />);
};
