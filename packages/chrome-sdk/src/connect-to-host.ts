// One call that finds the compositor, whichever way this page was opened.
//
// A shell's page runs in two places and the difference is not the shell's
// business:
//
//   the fork     what we ship. A document served over `domicile://` gets
//                `navigator.domicile`, a typed control channel to the
//                compositor, and that is the whole of the wiring
//   a browser     no compositor at all. `vite dev` on a shell's page is a real
//                thing to do, and it must lay out rather than throw
//
// There were two others, and both are gone rather than kept as shapes nothing
// produces: an Electron whose preload injected a channel at
// `window.domicileHost`, and a WebSocket to a bridge on the page's own origin
// that held the compositor's session socket. The fork has no preload and no
// world to cross, and the control channel is not reachable over TCP by
// anything — which was the point of moving it into the browser process.
//
// WRITING-A-SHELL.md used to have every shell branching on the host by hand.
// This is that branch, once, so a shell is
// `new DomicileClient(connectToHost())` and the requirement that a React developer gets a desktop out of a few lines
// around `ReactDOM.render` survives.

import type { DomicileHost } from "./domicile-host";

/** The globals this reads, named so a test can supply them. */
export type HostNavigator = {
  readonly domicile?: DomicileHost | null;
};

/** How the absence of a compositor is reported; a parameter so tests can hold it. */
const warnOnConsole = (message: string): void => {
  // biome-ignore lint/suspicious/noConsole: the only channel to the author
  console.warn(message);
};

/**
 * Whether anything will ever describe a desktop to this page.
 *
 * A second question from {@link connectToHost}'s, and one a shell genuinely
 * has to ask: with no compositor there is no display to lay windows out on, so
 * a shell takes the viewport's geometry instead.
 *
 * `connectToHost` is written in terms of this so the two cannot disagree.
 */
export const hasHost = (navigator: HostNavigator): boolean =>
  compositorOn(navigator) !== undefined;

/**
 * The compositor behind this page, or a stand-in that does nothing.
 *
 * **The stand-in is not a failure and must not throw.** A shell's page opened
 * in an ordinary browser has no compositor and should still render: that is
 * how a shell is styled, and how its layout is worked on, without a desktop
 * running. An `<app>` in such a page is an `HTMLUnknownElement` that takes a
 * box and shows nothing, and the SDK routes pointers over it exactly as it does
 * under the fork, so the seam a shell is written against is the same either way
 * and only the pixels are missing.
 *
 * **It is also not silent, which is the half that used to be missing.** The
 * old no-op transport said nothing at all, and a page whose windows never
 * appear is indistinguishable from a compositor with no clients running, from
 * a shell with a layout bug, and from a client that never drew. This layer is
 * the only one that knows which, so it says so — once, at startup, naming the
 * property it looked for and what will and will not work without it.
 *
 * **And it says it for the elements too, which is why they no longer do.** The
 * `<app>` element used to warn on its own account, when the `<canvas>` it made
 * had no `embedExternalSurface` on it; the tag is the engine's now, and the one
 * thing that defines it is the one thing that binds `navigator.domicile` — so a
 * page with an `<app>` that cannot show a window is exactly a page this warned
 * about already.
 *
 * @param warn - Where the absence is reported. Injected so a test can read it
 *   without a console.
 */
export const connectToHost = (
  navigator: HostNavigator,
  warn: typeof warnOnConsole = warnOnConsole,
): DomicileHost => {
  const compositor = compositorOn(navigator);
  if (compositor === undefined) {
    warn(
      "domicile: there is no compositor behind this page —" +
        " navigator.domicile is absent, so this document was not served by" +
        " the forked engine. The shell will lay out and style as usual; no" +
        " window will ever appear in it, nothing it asks the compositor for" +
        " will happen, and no desktop will be described.",
    );
  }
  return compositor ?? absentHost();
};

/**
 * The compositor, with the fork's `null` and a stock browser's absent property
 * read as the one thing they mean.
 *
 * Two spellings because there are two absences: the property does not exist at
 * all outside the fork, and the fork's own accessor answers `null` for a
 * document with no frame. `null` is not a value this codebase introduces — see
 * CONTROL_FLOW.md — but it is one WebIDL's `DomicileHost?` produces, and this
 * is the boundary where it stops.
 */
const compositorOn = (navigator: HostNavigator): DomicileHost | undefined =>
  navigator.domicile ?? undefined;

/**
 * A `DomicileHost` that answers every question with nothing.
 *
 * Every member, not only the ones a shell is likely to reach for: the client
 * registers a listener for every event type in its constructor, so a stand-in
 * missing `addEventListener` would throw before the shell had rendered a
 * single element. It is not an `EventTarget` behind that listener and does not
 * need to be — nothing will ever dispatch on it, so a listener that is dropped
 * on the floor and one that is kept and never called are the same thing.
 *
 * `displays` is `null`, which is what the engine's own attribute says before a
 * compositor has described a desktop. Here it is what it says forever, and
 * {@link hasHost} is how a shell knows the difference and reaches for the
 * viewport instead. Not `[]`: that would claim a desktop with no screens on
 * it, which is a description, and nothing here has described anything.
 */
const absentHost = (): DomicileHost => ({
  addEventListener: () => undefined,
  closeApp: () => undefined,
  displays: null,
  focusApp: () => undefined,
  focusChrome: () => undefined,
  grabShortcut: () => undefined,
  key: () => undefined,
  pointerAxis: () => undefined,
  pointerButton: () => undefined,
  pointerLeave: () => undefined,
  pointerMotion: () => undefined,
  resizeApp: () => undefined,
  setDesktopSize: () => undefined,
  setDevicePixelRatio: () => undefined,
  spawn: () => undefined,
});
