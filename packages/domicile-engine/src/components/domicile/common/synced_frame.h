// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_COMMON_SYNCED_FRAME_H_
#define COMPONENTS_DOMICILE_COMMON_SYNCED_FRAME_H_

#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <string_view>

#include "components/viz/common/surfaces/local_surface_id.h"

namespace domicile {

// The id of synced frame `frame` of a surface the page allocated as
// `allocated`: its child sequence number bumped by `frame`.
//
// The producer submits at it and the <app> whose `frame` is `frame` embeds
// it, so a commit and the page's move of its popup show in one frame. See
// docs/architecture/FRAME-SYNCED-SURFACES.md in the Domicile repository.
//
// `allocated` comes from a ParentLocalSurfaceIdAllocator that never takes a
// child's id, so its child sequence number is the initial one.
viz::LocalSurfaceId AtSyncedFrame(const viz::LocalSurfaceId& allocated,
                                  uint32_t frame);

// The newest synced frame the control channel named for each window, for an
// <app> whose page never sets `frame`.
//
// Once a surface is synced, its unsynced submits go up at its newest frame. A
// page that ignores frames would embed frame 0 and show a stale one, so its
// <app> embeds the newest frame heard instead. A page that sets `frame` gets
// the frame it set.
class KnownFrames {
 public:
  KnownFrames();
  ~KnownFrames();

  // `app_id` is at `frame`. An older frame than one already heard is
  // ignored: a reload's catch-up can trail a move.
  void Heard(std::string_view app_id, uint32_t frame);
  void Forget(std::string_view app_id);

  // The frame an <app> for `app_id` shows: `set`, the page's `frame`, if it
  // set one, else the newest heard.
  uint32_t Shown(std::string_view app_id, std::optional<uint32_t> set) const;

 private:
  std::map<std::string, uint32_t, std::less<>> frames_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_SYNCED_FRAME_H_
