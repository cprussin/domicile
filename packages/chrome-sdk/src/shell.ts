// What a shell module is, to the document Domicile writes.

/**
 * A shell: the function a shell module exports as `Shell`.
 *
 * Domicile imports the module and calls this once with the element to draw
 * in. Every other export is ignored, so one file can be both a config and a
 * shell. Importing the module does nothing but install its stylesheet; the
 * desktop starts here.
 */
export type Shell = (root: HTMLElement) => void;
