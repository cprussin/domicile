// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/will_navigate.h"

namespace domicile {

bool AsksBeforeNavigating(bool main_frame,
                          bool renderer_initiated,
                          ui::PageTransition transition) {
  return main_frame && renderer_initiated &&
         !(transition & ui::PAGE_TRANSITION_FORWARD_BACK) &&
         !ui::PageTransitionCoreTypeIs(transition, ui::PAGE_TRANSITION_RELOAD);
}

}  // namespace domicile
