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

// Where `argb` appears in the browser's window, if it appears at all. False if
// there is no window, nothing has been drawn, or the colour is not in it.
//
// A named point is the wrong question to ask of a shell. The spike pages put
// their canvases where the harness can compute them; a real shell decides
// where its windows go, in its own layout, and a guard that hard-coded a pixel
// would be asserting the shell's CSS rather than the seam. So this asks the
// question the guard actually has: is this client's window on the screen at
// all.
//
// One CaptureWindow rather than a grid of SamplePixel calls, which is a
// blocking readback each and starves the producer's thread — the reason the
// point probe is throttled in the first place.
//
// Exact match, like every other assertion in the spike: the clients draw one
// flat colour and a near-match would mean the compositor's own background, an
// anti-aliased edge, or a blend, none of which is a client's window.
DOMICILE_ENGINE_EXPORT bool domicile_engine_spike_find_colour(
    DomicileEngine* engine,
    uint32_t argb,
    int32_t* x,
    int32_t* y);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_SPIKE_H_
