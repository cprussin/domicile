// The type of a shell module's entry point.

/**
 * The function a shell module exports as `Shell`.
 *
 * Domicile calls it once with the root element to draw in. Other exports are
 * ignored, so one file can be both a config and a shell. Importing the module
 * should only install its stylesheet. See `docs/WRITING-A-SHELL.md`.
 */
export type Shell = (root: HTMLElement) => void;
