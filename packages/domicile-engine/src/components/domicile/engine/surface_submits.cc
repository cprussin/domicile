// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/surface_submits.h"

#include <algorithm>
#include <utility>

#include "base/check.h"

namespace domicile {

SurfaceSubmit::SurfaceSubmit() = default;
SurfaceSubmit::SurfaceSubmit(const SurfaceSubmit&) = default;
SurfaceSubmit& SurfaceSubmit::operator=(const SurfaceSubmit&) = default;
SurfaceSubmit::~SurfaceSubmit() = default;

SurfaceSubmits::Queued::Queued() = default;
SurfaceSubmits::Queued::Queued(const Queued&) = default;
SurfaceSubmits::Queued& SurfaceSubmits::Queued::operator=(const Queued&) =
    default;
SurfaceSubmits::Queued::~Queued() = default;

SurfaceSubmits::SurfaceSubmits() = default;
SurfaceSubmits::~SurfaceSubmits() = default;

std::vector<SurfaceSubmit> SurfaceSubmits::Push(const SurfaceSubmit& submit) {
  Queued queued;
  queued.submit = submit;
  queued_.push_back(queued);
  return TakeReady();
}

uint64_t SurfaceSubmits::Hold(const SurfaceSubmit& submit) {
  Queued queued;
  queued.ticket = next_ticket_++;
  queued.waiting = true;
  queued.submit = submit;
  queued_.push_back(queued);
  return queued.ticket;
}

std::vector<SurfaceSubmit> SurfaceSubmits::Fenced(
    uint64_t ticket,
    const std::optional<gpu::SyncToken>& sync_token) {
  auto iter = std::find_if(queued_.begin(), queued_.end(),
                           [ticket](const Queued& queued) {
                             return queued.waiting && queued.ticket == ticket;
                           });
  CHECK(iter != queued_.end());
  iter->waiting = false;
  if (sync_token.has_value()) {
    iter->submit.sync_token = *sync_token;
  } else {
    iter->submit.fence_refused = true;
  }
  return TakeReady();
}

std::vector<SurfaceSubmit> SurfaceSubmits::TakeReady() {
  std::vector<SurfaceSubmit> ready;
  while (!queued_.empty() && !queued_.front().waiting) {
    ready.push_back(queued_.front().submit);
    queued_.pop_front();
  }
  return ready;
}

SurfaceBacklog::Offered::Offered() = default;
SurfaceBacklog::Offered::Offered(const Offered&) = default;
SurfaceBacklog::Offered& SurfaceBacklog::Offered::operator=(const Offered&) =
    default;
SurfaceBacklog::Offered::~Offered() = default;

SurfaceBacklog::SurfaceBacklog() = default;
SurfaceBacklog::~SurfaceBacklog() = default;

SurfaceBacklog::Offered SurfaceBacklog::Offer(const SurfaceSubmit& submit,
                                              size_t in_viz) {
  Offered offered;
  if (in_viz < kMostInViz) {
    offered.send = submit;
    offered.replaced = std::exchange(held_, std::nullopt);
    return offered;
  }
  offered.replaced = std::exchange(held_, submit);
  return offered;
}

std::optional<SurfaceSubmit> SurfaceBacklog::Take(size_t in_viz) {
  if (in_viz >= kMostInViz) {
    return std::nullopt;
  }
  return std::exchange(held_, std::nullopt);
}

}  // namespace domicile
