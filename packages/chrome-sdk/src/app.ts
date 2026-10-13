// The type of an app module's entry point. See
// `docs/architecture/APP-MODULES.md`.

import type { DomicileAppHost } from "./domicile-host";

export type { DomicileAppHost, DomicileAppHostEventMap } from "./domicile-host";

/**
 * The function an app module exports as `main`.
 *
 * `domicile run-app <module>` opens an app window, and Domicile calls this
 * with the window's root element and the app's host. Pass the host to
 * `system()` from `./system`; the compositor answers files, processes and
 * D-Bus, and fails anything else with `permission_denied`.
 */
export type AppMain = (
  root: HTMLElement,
  host: DomicileAppHost,
) => void | Promise<void>;
