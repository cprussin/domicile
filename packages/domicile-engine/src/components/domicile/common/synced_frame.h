// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_COMMON_SYNCED_FRAME_H_
#define COMPONENTS_DOMICILE_COMMON_SYNCED_FRAME_H_

#include <cstdint>

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

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_SYNCED_FRAME_H_
