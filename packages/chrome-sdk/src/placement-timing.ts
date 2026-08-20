// How long a portal takes to measure and report itself.
//
// Every portal is measured on every animation frame — that is what makes a
// window follow a CSS transition — and most of those measurements find nothing
// changed and send nothing. So the cost is paid per window per frame whether or
// not the desktop is doing anything, and it is not a small one: a
// `getBoundingClientRect`, a `getComputedStyle`, and around twenty computed
// property reads, for every window the chrome has mounted.
//
// Whether that scales is a question about a number nobody had. This is the
// number.
//
// A sample that also *sent* a placement includes the send — the dedup key and
// the socket write — so the worst case over an interval is usually one of those
// rather than a measurement on its own. The average is safe from it, sends
// being rare against a thousand measurements, and pricing the whole of
// `#place()` is what makes the total the honest one.
//
// `count` is measurements rather than frames, because a desktop with twenty
// windows pays this twenty times per frame — so `count × average` over a
// reporting window is what to hold against the frame budget, and `worst` is
// what to hold against a dropped frame.

import { SampleWindow } from "./sample-window";

export const placementTiming = new SampleWindow();
