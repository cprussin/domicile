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

KnownFrames::KnownFrames() = default;
KnownFrames::~KnownFrames() = default;

void KnownFrames::Heard(std::string_view app_id, uint32_t frame) {
  auto [at, added] = frames_.try_emplace(std::string(app_id), frame);
  if (!added && at->second < frame) {
    at->second = frame;
  }
}

void KnownFrames::Forget(std::string_view app_id) {
  auto at = frames_.find(app_id);
  if (at != frames_.end()) {
    frames_.erase(at);
  }
}

uint32_t KnownFrames::Shown(std::string_view app_id,
                            std::optional<uint32_t> set) const {
  if (set) {
    return *set;
  }
  auto at = frames_.find(app_id);
  return at == frames_.end() ? 0u : at->second;
}

}  // namespace domicile
