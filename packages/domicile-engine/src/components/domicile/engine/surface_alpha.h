// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_SURFACE_ALPHA_H_
#define COMPONENTS_DOMICILE_ENGINE_SURFACE_ALPHA_H_

#include <cstdint>

namespace domicile {

// Whether a client's buffer in `fourcc` says how see-through each pixel is.
// One that does is blended over what the page draws under it -- a menu's
// rounded corners, a translucent terminal. One that does not is drawn opaque,
// which is what lets viz skip drawing whatever it covers.
bool FourccHasAlpha(uint32_t fourcc);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_ENGINE_SURFACE_ALPHA_H_
