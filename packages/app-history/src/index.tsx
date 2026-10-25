// The app module Domicile runs: follows the desktop's theme and motion
// setting, and mounts the app over the app host it spawns.

import {
  followReducedMotion,
  mediaThemeSource,
} from "@domicile-desktop/component-library/media-theme-source";
import { ThemeProvider } from "@domicile-desktop/component-library/ThemeProvider";
import { applyTheme } from "@domicile-desktop/component-library/theme-core";
import type { AppMain } from "@domicile-desktop/sdk/app";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { hostBrowser } from "./browser";
import { spawnedHost } from "./host";

import "./global.css";

export const main: AppMain = (root, domicile) => {
  const themes = mediaThemeSource();
  // Before the first paint, so the window never flashes the other theme.
  applyTheme(themes.theme ?? "dark");
  followReducedMotion();
  document.title = "History";
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider source={themes}>
        <App browser={hostBrowser(spawnedHost(domicile.processes))} />
      </ThemeProvider>
    </StrictMode>,
  );
};
