// The types of an app module's entry point and the host it is handed. See
// `docs/architecture/APP-MODULES.md`.

/** The events a {@link DomicileAppHost} dispatches. */
export type DomicileAppHostEventMap = {
  /** An answer to `callSystem`, whose `data` is the compositor's line. */
  system: MessageEvent<string>;
};

/**
 * The host an app module's `main` is handed: system calls and their answers.
 *
 * Pass it to `system()` from `@domicile-desktop/sdk/system`, as a shell
 * passes its desktop. The compositor answers files, processes and D-Bus, and
 * fails anything else with `permission_denied`.
 */
export type DomicileAppHost = {
  callSystem(id: number, request: string): void;
  onsystem: ((event: MessageEvent<string>) => void) | null;
  addEventListener<T extends keyof DomicileAppHostEventMap>(
    type: T,
    listener: (event: DomicileAppHostEventMap[T]) => void,
  ): void;
  removeEventListener<T extends keyof DomicileAppHostEventMap>(
    type: T,
    listener: (event: DomicileAppHostEventMap[T]) => void,
  ): void;
};

/**
 * The function an app module exports as `main`.
 *
 * `domicile run-app <module>` opens an app window, and Domicile calls this
 * with the window's root element and the app's host.
 */
export type AppMain = (
  root: HTMLElement,
  host: DomicileAppHost,
) => void | Promise<void>;
