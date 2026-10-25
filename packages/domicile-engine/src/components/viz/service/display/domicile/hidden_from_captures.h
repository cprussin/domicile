// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_HIDDEN_FROM_CAPTURES_H_
#define COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_HIDDEN_FROM_CAPTURES_H_

#include "base/containers/flat_set.h"
#include "base/functional/function_ref.h"
#include "components/viz/common/quads/aggregated_render_pass.h"

namespace viz::domicile {

// Leaves the passes in `hidden` out of what the copy requests in `passes`
// read. `passes` is an aggregated frame's, the root last.
//
// A pass with copy requests that draws a hidden pass, itself or through
// passes it draws, gets a copy without it: each pass on the way is copied
// without the quads that draw a hidden pass, just before its original, and
// the requests move to the copy. The copies are drawn only for the requests;
// the screen shows the originals.
//
// `copy_id` names the copy of a pass. The same id each frame keeps the copy's
// backing.
void HideFromCaptures(
    AggregatedRenderPassList& passes,
    const base::flat_set<AggregatedRenderPassId>& hidden,
    base::FunctionRef<AggregatedRenderPassId(AggregatedRenderPassId)>
        copy_id);

}  // namespace viz::domicile

#endif  // COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_HIDDEN_FROM_CAPTURES_H_
