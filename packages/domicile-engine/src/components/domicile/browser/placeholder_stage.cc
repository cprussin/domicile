// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/placeholder_stage.h"

#include "url/gurl.h"

namespace domicile {

PlaceholderStage StageOf(bool frame_exists, const GURL& last_committed_url) {
  if (!frame_exists) {
    return PlaceholderStage::kAbsent;
  }
  return last_committed_url.is_empty() ? PlaceholderStage::kCommitting
                                       : PlaceholderStage::kReady;
}

}  // namespace domicile
