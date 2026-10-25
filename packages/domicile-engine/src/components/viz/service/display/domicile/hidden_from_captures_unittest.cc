// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/viz/service/display/domicile/hidden_from_captures.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "base/functional/callback_helpers.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/test/task_environment.h"
#include "components/viz/common/frame_sinks/copy_output_request.h"
#include "components/viz/common/quads/aggregated_render_pass_draw_quad.h"
#include "components/viz/common/quads/solid_color_draw_quad.h"
#include "components/viz/service/display/domicile/hidden_from_captures_id.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/rect.h"

namespace viz::domicile {
namespace {

constexpr gfx::Rect kArea(100, 100);

AggregatedRenderPassId Id(uint64_t id) {
  return AggregatedRenderPassId(id);
}

// Pass `id`, drawing a solid quad, then each of `drawn`.
std::unique_ptr<AggregatedRenderPass> Pass(
    uint64_t id,
    const std::vector<uint64_t>& drawn = {}) {
  auto pass = std::make_unique<AggregatedRenderPass>();
  pass->SetNew(Id(id), kArea, gfx::Rect(10, 10), gfx::Transform());
  const SharedQuadState* state = pass->CreateAndAppendSharedQuadState();
  pass->CreateAndAppendDrawQuad<SolidColorDrawQuad>()->SetNew(
      state, kArea, kArea, SkColors::kRed, false);
  for (uint64_t other : drawn) {
    pass->CreateAndAppendDrawQuad<AggregatedRenderPassDrawQuad>()->SetNew(
        state, kArea, kArea, Id(other), kInvalidResourceId, gfx::RectF(),
        gfx::Size(), false);
  }
  return pass;
}

void Request(AggregatedRenderPass& pass) {
  pass.copy_requests.push_back(std::make_unique<CopyOutputRequest>(
      CopyOutputRequest::ResultFormat::RGBA,
      CopyOutputRequest::ResultDestination::kSystemMemory, base::DoNothing()));
}

// Each pass's id and the passes it draws, in order, with `*` after the id of
// one with copy requests: "2 1*:2" is pass 2, then pass 1 drawing pass 2,
// with requests.
std::string Spelled(const AggregatedRenderPassList& passes) {
  std::vector<std::string> spelled;
  for (const auto& pass : passes) {
    std::string one = base::NumberToString(pass->id.value());
    if (!pass->copy_requests.empty()) {
      one += "*";
    }
    for (const DrawQuad* quad : pass->quad_list) {
      if (const auto* pass_quad =
              quad->DynamicCast<AggregatedRenderPassDrawQuad>()) {
        one += ":" + base::NumberToString(pass_quad->render_pass_id.value());
      }
    }
    spelled.push_back(one);
  }
  return base::JoinString(spelled, " ");
}

// Hides `hidden` from `passes`, naming a pass's copy 100 more than it.
std::string Hidden(AggregatedRenderPassList passes,
                   const base::flat_set<AggregatedRenderPassId>& hidden) {
  HideFromCaptures(passes, hidden, [](AggregatedRenderPassId id) {
    return Id(id.value() + 100);
  });
  return Spelled(passes);
}

// A copy request takes the current sequence's task runner to reply on.
class HiddenFromCapturesTest : public testing::Test {
 private:
  base::test::TaskEnvironment task_environment_;
};

TEST_F(HiddenFromCapturesTest,
       ACaptureOfTheRootReadsACopyWithoutTheHiddenPass) {
  AggregatedRenderPassList passes;
  passes.push_back(Pass(2));
  passes.push_back(Pass(1, {2}));
  Request(*passes.back());

  EXPECT_EQ(Hidden(std::move(passes), {Id(2)}), "2 101* 1:2");
}

TEST_F(HiddenFromCapturesTest, PassesOnTheWayToTheHiddenOneAreCopiedToo) {
  AggregatedRenderPassList passes;
  passes.push_back(Pass(3));
  passes.push_back(Pass(2, {3}));
  passes.push_back(Pass(4));
  passes.push_back(Pass(1, {2, 4}));
  Request(*passes.back());

  // Pass 4 shows nothing hidden, so both drawings of the root draw it.
  EXPECT_EQ(Hidden(std::move(passes), {Id(3)}), "3 102 2:3 4 101*:102:4 1:2:4");
}

TEST_F(HiddenFromCapturesTest, ACopyIsDrawnWhole) {
  AggregatedRenderPassList passes;
  passes.push_back(Pass(2));
  passes.push_back(Pass(1, {2}));
  passes.back()->cache_render_pass = true;
  Request(*passes.back());

  HideFromCaptures(passes, {Id(2)}, [](AggregatedRenderPassId id) {
    return Id(id.value() + 100);
  });

  const AggregatedRenderPass& copy = *passes[1];
  EXPECT_EQ(copy.damage_rect, copy.output_rect);
  EXPECT_TRUE(copy.has_damage_from_contributing_content);
  EXPECT_FALSE(copy.cache_render_pass);
  // Its solid quad, and its state.
  EXPECT_EQ(copy.quad_list.size(), 1u);
  EXPECT_EQ(copy.quad_list.front()->shared_quad_state,
            copy.shared_quad_state_list.front());
}

TEST_F(HiddenFromCapturesTest, AFrameNobodyCapturesIsLeftAlone) {
  AggregatedRenderPassList passes;
  passes.push_back(Pass(2));
  passes.push_back(Pass(1, {2}));

  EXPECT_EQ(Hidden(std::move(passes), {Id(2)}), "2 1:2");
}

TEST_F(HiddenFromCapturesTest, ACaptureOfWhatShowsNothingHiddenIsLeftAlone) {
  AggregatedRenderPassList passes;
  passes.push_back(Pass(2));
  passes.push_back(Pass(3));
  Request(*passes.back());
  passes.push_back(Pass(1, {2, 3}));

  EXPECT_EQ(Hidden(std::move(passes), {Id(2)}), "2 3* 1:2:3");
}

TEST_F(HiddenFromCapturesTest, ACaptureOfTheHiddenPassItselfReadsIt) {
  AggregatedRenderPassList passes;
  passes.push_back(Pass(2));
  Request(*passes.back());
  passes.push_back(Pass(1, {2}));

  EXPECT_EQ(Hidden(std::move(passes), {Id(2)}), "2* 1:2");
}

TEST_F(HiddenFromCapturesTest, TheGuidThePageSeesIsTheTokenVizSees) {
  std::string hex;
  base::RemoveChars(kHiddenFromCapturesGuid, "-", &hex);
  ASSERT_EQ(hex.size(), 32u);
  uint64_t high = 0;
  uint64_t low = 0;
  ASSERT_TRUE(base::HexStringToUInt64(hex.substr(0, 16), &high));
  ASSERT_TRUE(base::HexStringToUInt64(hex.substr(16), &low));

  EXPECT_EQ(base::Token(high, low), kHiddenFromCaptures);
}

}  // namespace
}  // namespace viz::domicile
