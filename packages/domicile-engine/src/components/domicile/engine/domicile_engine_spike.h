// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_SPIKE_H_
#define COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_SPIKE_H_

#include <stdint.h>

#include "components/domicile/engine/domicile_engine.h"

// THROWAWAY, and separate from domicile_engine.h so that it is obvious which
// of the two is the seam.
//
// The browser's invitation carries a SpikeProbe pipe beside the broker's, and
// the library is the only thing holding that invitation — one producer per
// socket, because OutgoingInvitation::Send consumes the server endpoint. So a
// harness that wants to know what viz actually drew has to ask through here.
//
// Deleted with the rest of the spike, when domicile-compositor is the producer
// and its own output is the evidence.

#ifdef __cplusplus
extern "C" {
#endif

// The colour the display compositor drew at the centre of the browser's
// window, as SkColor (ARGB). False if there is no window yet or nothing has
// been drawn.
//
// The centre rather than a coordinate because that is where every spike page
// puts the <app>, and because it is the same pixel steps 2 and 3 are recorded
// on. Blocking: it is an assertion in a test, and a test that raced the thing
// it asserts on would be worse than a slow one.
DOMICILE_ENGINE_EXPORT bool domicile_engine_spike_sample_window_center(
    DomicileEngine* engine,
    uint32_t* argb);

// The colour at `x`, `y` in the browser's window, as SkColor (ARGB). False if
// there is no window yet, nothing has been drawn, or the point is outside it.
//
// The centre is not enough once a page holds more than one <app>: two windows
// side by side have no pixel that is both, and "viz aggregated two surfaces
// into one page" is exactly the claim the unit tests cannot make -- they
// exercise the broker's bookkeeping, not the aggregator. So the two-window
// guard names a point inside each canvas and asserts a different client's
// colour at each.
//
// Outside the window fails rather than clamps, the same way SpikeProbe's
// SamplePixel does: a measurement that silently samples the wrong pixel is
// worse than one that stops.
DOMICILE_ENGINE_EXPORT bool domicile_engine_spike_sample_pixel(
    DomicileEngine* engine,
    int32_t x,
    int32_t y,
    uint32_t* argb);

// Where `argb` is in the browser's window, and how big that window is.
//
//   -1  the window could not be captured — no window yet, nothing drawn, or
//       no probe pipe. Nothing was measured and nothing follows about the
//       colour.
//    0  captured, and the colour is not in it. This is a measurement, and it
//       includes a capture that came back with no pixels at all: a 0x0 window
//       is a fact about the coordinate space, not a failure to read one.
//    1  captured, and the colour is in it.
//
// Three values rather than a bool, because a guard's negative control turns on
// exactly this distinction: "the colour is not on screen" is the control
// passing, and "nothing could be read" is the control having measured nothing
// while looking identical.
//
// `out` carries the answer. Its `window_width` and `window_height` are written
// on 0 and 1; its `x`, `y`, `width` and `height` are written only on 1.
// Nothing is written on -1.
//
// A struct rather than an array of six, because this tree builds with
// `-Wunsafe-buffer-usage` and indexing a bare `int32_t*` is an error under it.
// Naming the fields is what the warning is asking for anyway.
//
// A BOX AND A SIZE RATHER THAN A POINT, because the first matching pixel
// answers the wrong question. A guard that samples a named point and gets the
// wrong colour needs to know whether the colour is elsewhere, *where* the
// region it belongs to actually is, and what coordinate space the capture is
// in — the window it was asked for and the bitmap it got back are not
// obliged to be the same size, and a probe that cannot say so makes a
// coordinate bug look like a missing surface.
//
// A named point is also the wrong question to ask of a shell. The spike pages
// put their canvases where the harness can compute them; a real shell decides
// where its windows go, in its own layout, and a guard that hard-coded a pixel
// would be asserting the shell's CSS rather than the seam.
//
// One CaptureWindow rather than a grid of SamplePixel calls, which is a
// blocking readback each and starves the producer's thread — the reason the
// point probe is throttled in the first place.
//
// Exact match, like every other assertion in the spike: the clients draw one
// flat colour and a near-match would mean the compositor's own background, an
// anti-aliased edge, or a blend, none of which is a client's window.
typedef struct DomicileSpikeCapture {
  // The colour's bounding box in the captured bitmap.
  int32_t x;
  int32_t y;
  int32_t width;
  int32_t height;
  // The captured bitmap's own size, which is not obliged to be the size the
  // browser's window was asked for.
  int32_t window_width;
  int32_t window_height;
} DomicileSpikeCapture;

DOMICILE_ENGINE_EXPORT int32_t domicile_engine_spike_find_colour(
    DomicileEngine* engine,
    uint32_t argb,
    DomicileSpikeCapture* out);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_SPIKE_H_
