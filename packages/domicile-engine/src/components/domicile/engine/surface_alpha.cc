// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/surface_alpha.h"

namespace domicile {

bool FourccHasAlpha(uint32_t fourcc) {
  switch (fourcc) {
    case 0x34325241:  // DRM_FORMAT_ARGB8888
    case 0x34324241:  // DRM_FORMAT_ABGR8888
      return true;
    default:
      return false;
  }
}

}  // namespace domicile
