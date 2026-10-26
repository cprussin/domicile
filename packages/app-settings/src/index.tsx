// The app module Domicile runs: follows the desktop's theme and motion
// setting, and mounts the app over the settings host it spawns.

import {
  followReducedMotion,
  mediaThemeSource,
} from "@domicile-desktop/component-library/media-theme-source";
import { ThemeProvider } from "@domicile-desktop/component-library/ThemeProvider";
import { applyTheme } from "@domicile-desktop/component-library/theme-core";
import type { AppMain } from "@domicile-desktop/sdk/app";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import icon from "../icons/settings.svg";
import { App } from "./App";
import { hostExtensions } from "./extensions";
import { spawnedHost } from "./host";

import "./global.css";

export const main: AppMain = (root, domicile) => {
  const themes = mediaThemeSource();
  // Before the first paint, so the window never flashes the other theme.
  applyTheme(themes.theme ?? "dark");
  followReducedMotion();
  document.title = "Settings";
  // The launcher's icon, which the shell draws for the window.
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = icon;
  document.head.append(link);
  const settings = spawnedHost(domicile.processes);
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider source={themes}>
        <App extensions={hostExtensions(settings)} host={settings} />
      </ThemeProvider>
    </StrictMode>,
  );
};
