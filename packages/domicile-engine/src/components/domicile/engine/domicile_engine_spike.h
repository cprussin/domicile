// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_SPIKE_H_
#define COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_SPIKE_H_

#include <stdint.h>

#include "components/domicile/engine/domicile_engine.h"

// Throwaway test probes for what viz drew, kept apart from domicile_engine.h.
//
// Only the library holds the browser's mojo invitation, which carries the
// SpikeProbe pipe, so test harnesses query viz through these functions.

#ifdef __cplusplus
extern "C" {
#endif

// The color viz drew at the center of the browser's window, as SkColor
// (ARGB). False if there is no window yet or nothing has been drawn.
//
// Blocks until the readback completes.
DOMICILE_ENGINE_EXPORT bool domicile_engine_spike_sample_window_center(
    DomicileEngine* engine,
    uint32_t* argb);

// The color at `x`, `y` in the browser's window, as SkColor (ARGB). False if
// there is no window yet, nothing has been drawn, or the point is outside it.
//
// Used to check that viz composites several surfaces into one page. Points
// outside the window fail rather than clamp, so a wrong pixel is never
// sampled silently.
DOMICILE_ENGINE_EXPORT bool domicile_engine_spike_sample_pixel(
    DomicileEngine* engine,
    int32_t x,
    int32_t y,
    uint32_t* argb);

typedef struct DomicileSpikeCapture {
  // The color's bounding box in the captured bitmap.
  int32_t x;
  int32_t y;
  int32_t width;
  int32_t height;
  // The captured bitmap's size, which may differ from the requested window
  // size.
  int32_t window_width;
  int32_t window_height;
} DomicileSpikeCapture;

// The Rust side mirrors this as a #[repr(C)] struct of six i32.
#ifdef __cplusplus
static_assert(sizeof(DomicileSpikeCapture) == 6 * sizeof(int32_t),
              "DomicileSpikeCapture must stay six packed int32_t");
#endif

// Finds the bounding box of the exact color `argb` in the browser's window.
//
//   -1  the window could not be captured (no window, nothing drawn, or no
//       probe pipe). Nothing was measured.
//    0  captured, and the color is not in it.
//    1  captured, and the color is in it.
//
// Tests need -1 and 0 kept apart: a negative control passes only on 0.
//
// On 0 and 1, writes `out`'s `window_width` and `window_height`; on 1, also
// its `x`, `y`, `width` and `height`. Writes nothing on -1.
//
// Uses one capture rather than many SamplePixel calls, each of which is a
// blocking readback that starves the producer's thread.
DOMICILE_ENGINE_EXPORT int32_t domicile_engine_spike_find_color(
    DomicileEngine* engine,
    uint32_t argb,
    DomicileSpikeCapture* out);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_SPIKE_H_
