// What a shell module is, to the document Domicile writes.

import type { DomicileHost } from "./domicile-host";

/**
 * A shell: the function a shell module exports as `Shell`.
 *
 * Domicile imports the module and calls this once with the element to draw
 * in and the desktop. Every other export is ignored, so one file can be both
 * a config and a shell. Importing the module does nothing but install its
 * stylesheet; the desktop starts here.
 *
 * **`domicile` is the only copy.** The engine hands the desktop out once per
 * document, to the page that calls this, so there is no global to reach for:
 * keep it however the shell likes — a React context, a module's own variable
 * — and pass it to what needs it.
 */
export type Shell = (root: HTMLElement, domicile: DomicileHost) => void;
