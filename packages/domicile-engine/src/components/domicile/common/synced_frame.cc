// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/common/synced_frame.h"

#include "base/check_op.h"

namespace domicile {

viz::LocalSurfaceId AtSyncedFrame(const viz::LocalSurfaceId& allocated,
                                  uint32_t frame) {
  CHECK_EQ(allocated.child_sequence_number(), viz::kInitialChildSequenceNumber);
  return viz::LocalSurfaceId(allocated.parent_sequence_number(),
                             viz::kInitialChildSequenceNumber + frame,
                             allocated.embed_token());
}

}  // namespace domicile
