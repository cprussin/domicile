// What a shell running in the "Make your own desktop" preview may import.

import * as domicileProvider from "@domicile-desktop/react/domicile-provider";
import * as mount from "@domicile-desktop/react/mount";
import * as nestedShell from "@domicile-desktop/react/nested-shell";
import * as windows from "@domicile-desktop/react/windows";
import * as react from "react";
import * as jsxRuntime from "react/jsx-runtime";

import type { Modules } from "./compile";

/**
 * React and Domicile's React library, as `domicile` gives a shell. Tailwind's
 * import does nothing: the preview's frame loads the same build itself.
 */
export const PREVIEW_MODULES: Modules = {
  "@domicile-desktop/react/domicile-provider": domicileProvider,
  "@domicile-desktop/react/mount": mount,
  "@domicile-desktop/react/nested-shell": nestedShell,
  "@domicile-desktop/react/windows": windows,
  "@tailwindcss/browser": {},
  react,
  "react/jsx-runtime": jsxRuntime,
};
