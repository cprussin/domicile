// Entry point of `history.html`: follows the desktop's theme and motion
// setting, and mounts the app over the extension APIs.

import {
  followReducedMotion,
  mediaThemeSource,
} from "@domicile-desktop/component-library/media-theme-source";
import { ThemeProvider } from "@domicile-desktop/component-library/ThemeProvider";
import { applyTheme } from "@domicile-desktop/component-library/theme-core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { chromeBrowser } from "./browser";

import "./global.css";

const themes = mediaThemeSource();
// Before the first paint, so the page never flashes the other theme.
applyTheme(themes.theme ?? "dark");
followReducedMotion();

const root = document.getElementById("root");
if (root === null) {
  throw new Error("history.html has no #root");
} else {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider source={themes}>
        <App browser={chromeBrowser()} />
      </ThemeProvider>
    </StrictMode>,
  );
}
