// Entry point: `Shell` draws the splash in the desktop's theme and accent.
// Importing this module only installs its stylesheet.

import { applyAppearance } from "@domicile-desktop/component-library/appearance";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";
import { createRoot } from "react-dom/client";

import { followTheme } from "./follow-theme";
import { Splash } from "./Splash";

import "./global.css";

/** The splash, mounted into `root` for as long as the page lives. */
export const Shell: ShellModule = (root, host) => {
  const domicile = desktop(host);
  followTheme(domicile);
  const { appearance } = domicile;
  applyAppearance(appearance);
  appearance.on("change", () => {
    applyAppearance(appearance);
  });
  // A child of `root`: the document reports failures by appending to it.
  const mount = document.createElement("div");
  root.append(mount);
  createRoot(mount).render(<Splash domicile={domicile} />);
};
