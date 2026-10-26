// Entry point: `Shell` takes the desktop and mounts the React desktop.
// Importing this module only installs its stylesheet.

import { mount } from "@domicile-desktop/react/mount";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

import { Shell as Desktop } from "./Shell";

import "./shell.css";

/** The simple desktop, mounted into `root`. */
export const Shell: ShellModule = mount(Desktop);
