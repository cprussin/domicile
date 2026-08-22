// The key combination that travels on the shortcut channels, in the terms a
// page names its keys (`KeyboardEvent.key`) rather than the evdev keycodes the
// host protocol speaks. The Electron host matches these against the keys an
// embedded page reports, and has no keymap to resolve a scancode against.
//
// Its own module, beside the channel names, because it is the payload those
// channels carry: the page, the preload and the main process all speak it, and
// none of them should be reaching into another's module for the shape.

export type Chord = {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
};
