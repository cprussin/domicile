// The type of an app module's entry point. See
// `docs/architecture/APP-MODULES.md`.

import type { AppDomicile } from "./desktop/app-desktop";

export type { AppDomicile } from "./desktop/app-desktop";

/**
 * The function an app module exports as `main`.
 *
 * `domicile open --app <module>` opens an app window, and Domicile calls this
 * with the window's root element and the app's desktop: files, processes and
 * D-Bus. The compositor fails anything else with `permission_denied`.
 */
export type AppMain = (
  root: HTMLElement,
  domicile: AppDomicile,
) => void | Promise<void>;
