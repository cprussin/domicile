// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/viz/service/display/domicile/hidden_from_captures.h"

#include <memory>
#include <optional>
#include <utility>

#include "base/containers/flat_map.h"
#include "components/viz/common/frame_sinks/copy_output_request.h"
#include "components/viz/common/quads/aggregated_render_pass_draw_quad.h"
#include "components/viz/common/quads/draw_quad.h"
#include "components/viz/common/quads/shared_quad_state.h"

namespace viz::domicile {

namespace {

using Ids = base::flat_set<AggregatedRenderPassId>;

// The pass `quad` draws, if it draws one.
std::optional<AggregatedRenderPassId> DrawnPass(const DrawQuad* quad) {
  if (const auto* pass_quad =
          quad->DynamicCast<AggregatedRenderPassDrawQuad>()) {
    return pass_quad->render_pass_id;
  }
  return std::nullopt;
}

// A copy of `pass`, named `id`, without its quads that draw a pass in
// `hidden`, drawing the copies in `copies` in place of their originals.
std::unique_ptr<AggregatedRenderPass> CopyWithout(
    const AggregatedRenderPass& pass,
    AggregatedRenderPassId id,
    const Ids& hidden,
    const base::flat_map<AggregatedRenderPassId, AggregatedRenderPassId>&
        copies) {
  std::unique_ptr<AggregatedRenderPass> copy = pass.Copy(id);
  // Drawn only for its requests, so drawn whole every time.
  copy->damage_rect = copy->output_rect;
  copy->has_damage_from_contributing_content = true;
  copy->cache_render_pass = false;
  const SharedQuadState* copied_state = nullptr;
  for (const DrawQuad* quad : pass.quad_list) {
    const std::optional<AggregatedRenderPassId> drawn = DrawnPass(quad);
    if (drawn && hidden.contains(*drawn)) {
      continue;
    }
    if (quad->shared_quad_state != copied_state) {
      *copy->CreateAndAppendSharedQuadState() = *quad->shared_quad_state;
      copied_state = quad->shared_quad_state;
    }
    if (!drawn) {
      copy->CopyFromAndAppendDrawQuad(quad);
      continue;
    }
    AggregatedRenderPassDrawQuad* pass_quad =
        copy->CopyFromAndAppendRenderPassDrawQuad(
            AggregatedRenderPassDrawQuad::MaterialCast(quad));
    if (auto it = copies.find(*drawn); it != copies.end()) {
      pass_quad->render_pass_id = it->second;
    }
  }
  return copy;
}

}  // namespace

void HideFromCaptures(
    AggregatedRenderPassList& passes,
    const Ids& hidden,
    base::FunctionRef<AggregatedRenderPassId(AggregatedRenderPassId)>
        copy_id) {
  if (hidden.empty()) {
    return;
  }

  // The passes that show a hidden pass, by drawing it or a pass that shows
  // one. A pass draws only passes before it.
  Ids showing;
  for (const auto& pass : passes) {
    for (const DrawQuad* quad : pass->quad_list) {
      const std::optional<AggregatedRenderPassId> drawn = DrawnPass(quad);
      if (drawn && (hidden.contains(*drawn) || showing.contains(*drawn))) {
        showing.insert(pass->id);
        break;
      }
    }
  }

  // Of those, the ones a copy request reads, and the ones they draw. A hidden
  // pass's own requests read it, so it stays as it is.
  Ids copied;
  for (auto it = passes.rbegin(); it != passes.rend(); ++it) {
    const AggregatedRenderPass& pass = **it;
    if (!showing.contains(pass.id) || hidden.contains(pass.id) ||
        (pass.copy_requests.empty() && !copied.contains(pass.id))) {
      continue;
    }
    copied.insert(pass.id);
    for (const DrawQuad* quad : pass.quad_list) {
      const std::optional<AggregatedRenderPassId> drawn = DrawnPass(quad);
      if (drawn && showing.contains(*drawn) && !hidden.contains(*drawn)) {
        copied.insert(*drawn);
      }
    }
  }
  if (copied.empty()) {
    return;
  }

  // Each copy just before its original: after the copies it draws, and never
  // last, which is the root's place.
  base::flat_map<AggregatedRenderPassId, AggregatedRenderPassId> copies;
  AggregatedRenderPassList with_copies;
  with_copies.reserve(passes.size() + copied.size());
  for (auto& pass : passes) {
    if (copied.contains(pass->id)) {
      const AggregatedRenderPassId id = copy_id(pass->id);
      std::unique_ptr<AggregatedRenderPass> copy =
          CopyWithout(*pass, id, hidden, copies);
      copy->copy_requests = std::move(pass->copy_requests);
      pass->copy_requests.clear();
      copies.emplace(pass->id, id);
      with_copies.push_back(std::move(copy));
    }
    with_copies.push_back(std::move(pass));
  }
  passes = std::move(with_copies);
}

}  // namespace viz::domicile
