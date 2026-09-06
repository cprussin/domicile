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

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_SPIKE_H_
