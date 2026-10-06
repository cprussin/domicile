// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_SURFACE_ALPHA_H_
#define COMPONENTS_DOMICILE_ENGINE_SURFACE_ALPHA_H_

#include <cstdint>

namespace domicile {

// Whether the `fourcc` pixel format has an alpha channel.
//
// Buffers with alpha are blended over the page; others are drawn opaque so viz
// can skip drawing what they cover.
bool FourccHasAlpha(uint32_t fourcc);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_ENGINE_SURFACE_ALPHA_H_
