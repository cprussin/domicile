// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_CAPTURED_COLOR_H_
#define COMPONENTS_DOMICILE_ENGINE_CAPTURED_COLOR_H_

#include <cstdint>

#include "components/domicile/engine/domicile_engine.h"

namespace domicile {

// The 0xRRGGBB at the center of a captured frame's content, or -1 if the
// probes cannot read it. Reads shared memory and linear dmabufs in ARGB8888
// or ABGR8888. Used by the capture probes.
int64_t CenterColor(const DomicileCapturedFrame& record);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_ENGINE_CAPTURED_COLOR_H_
