// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_SURFACE_SUBMITS_H_
#define COMPONENTS_DOMICILE_ENGINE_SURFACE_SUBMITS_H_

#include <cstdint>
#include <optional>
#include <vector>

#include "base/containers/circular_deque.h"
#include "components/domicile/engine/surface_transform.h"
#include "gpu/command_buffer/common/sync_token.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {

// One wl_surface.commit for the engine to send viz.
struct SurfaceSubmit {
  SurfaceSubmit();
  SurfaceSubmit(const SurfaceSubmit&);
  SurfaceSubmit& operator=(const SurfaceSubmit&);
  ~SurfaceSubmit();

  uint64_t buffer = 0;
  gfx::Rect crop;
  gfx::Rect damage;
  uint64_t box = 0;
  BufferTransform transform = BufferTransform::kNormal;
  // What viz waits on before it samples the buffer: the browser's token for
  // the buffer's acquire fence. Empty for a buffer the compositor finished
  // drawing before it submitted.
  gpu::SyncToken sync_token;
  // The browser refused the acquire fence, so viz must not sample the buffer.
  bool fence_refused = false;
};

// A surface's submits, held in order behind any whose acquire fence the
// browser has not yet put in place.
//
// Viz takes a surface's frames in the order they are sent, and the compositor
// numbers them in the order it submits, so a fenced submit holds back every
// later one.
class SurfaceSubmits {
 public:
  SurfaceSubmits();
  SurfaceSubmits(const SurfaceSubmits&) = delete;
  SurfaceSubmits& operator=(const SurfaceSubmits&) = delete;
  ~SurfaceSubmits();

  // Queues `submit` and returns the submits ready to go, in order: `submit`
  // itself unless an earlier one waits for its fence.
  std::vector<SurfaceSubmit> Push(const SurfaceSubmit& submit);

  // Queues `submit` until its fence is in place. Returns the ticket to pass to
  // Fenced.
  uint64_t Hold(const SurfaceSubmit& submit);

  // The browser put `ticket`'s fence in place behind `sync_token`, or refused
  // it when `sync_token` is nullopt. Returns the submits ready to go, in
  // order. A ticket Hold did not return, or one already fenced, aborts.
  std::vector<SurfaceSubmit> Fenced(
      uint64_t ticket,
      const std::optional<gpu::SyncToken>& sync_token);

 private:
  struct Queued {
    Queued();
    Queued(const Queued&);
    Queued& operator=(const Queued&);
    ~Queued();

    // Zero for a submit that waits for nothing.
    uint64_t ticket = 0;
    bool waiting = false;
    SurfaceSubmit submit;
  };

  // Takes the submits at the front that wait for nothing.
  std::vector<SurfaceSubmit> TakeReady();

  base::circular_deque<Queued> queued_;
  uint64_t next_ticket_ = 1;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_ENGINE_SURFACE_SUBMITS_H_
