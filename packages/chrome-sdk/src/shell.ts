// The type of a shell module's entry point.

import type { DomicileHost } from "./domicile-host";

/**
 * The function a shell module exports as `Shell`.
 *
 * Domicile calls it once with the root element to draw in and the desktop.
 * Other exports are ignored, so one file can be both a config and a shell.
 * Importing the module should only install its stylesheet. See
 * `docs/WRITING-A-SHELL.md`.
 *
 * `domicile` is the only copy: the engine calls this itself and makes the
 * desktop for the call, so there is no global. Keep it however the shell
 * likes (a React context, a variable) and pass it to what needs it.
 */
export type Shell = (root: HTMLElement, domicile: DomicileHost) => void;
