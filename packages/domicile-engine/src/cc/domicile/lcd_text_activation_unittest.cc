// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "base/test/task_environment.h"
#include "cc/test/fake_layer_tree_host_impl.h"
#include "cc/test/fake_picture_layer_impl.h"
#include "cc/test/fake_raster_source.h"
#include "cc/test/test_layer_tree_host_base.h"
#include "cc/tiles/picture_layer_tiling.h"
#include "cc/trees/layer_tree_settings.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace cc {
namespace {

// TestLayerTreeHostBase reads the current task runner as it is constructed,
// so the environment has to be a base that comes before it.
struct WithTaskEnvironment {
  base::test::TaskEnvironment task_environment;
};

class DomicileLcdTextActivationTest : private WithTaskEnvironment,
                                      public TestLayerTreeHostBase {
 protected:
  void SetUp() override {
    TestLayerTreeHostBase::SetUp();
    host_impl()->active_tree()->SetDeviceViewportRect(gfx::Rect(10000, 10000));
  }

  LayerTreeSettings CreateSettings() override {
    LayerTreeSettings settings = TestLayerTreeHostBase::CreateSettings();
    settings.commit_to_active_tree = false;
    settings.gpu_rasterization_disabled = true;
    return settings;
  }

  // A pending tree whose one tiling was rastered with LCD text, ready to
  // activate, and whose contents then stopped being opaque. In a page that is
  // an impl-side transform animation ending after the tree is ready: the
  // reason LCD text is off moves from the animation to the contents with no
  // commit in between.
  PictureLayerTiling* ReadyTreeLosesLcdText() {
    SetupPendingTree(
        FakeRasterSource::CreateFilledWithText(gfx::Size(100, 100)));
    pending_layer()->SetContentsOpaque(true);
    pending_layer()->UpdateTiles();
    PictureLayerTiling* tiling = pending_layer()->HighResTiling();
    EXPECT_TRUE(tiling->can_use_lcd_text());

    host_impl()->delegate()->NotifyReadyToActivate();
    pending_layer()->SetContentsOpaque(false);
    pending_layer()->UpdateTiles();
    return tiling;
  }
};

TEST_F(DomicileLcdTextActivationTest, ATreeReadyToActivateKeepsItsTiles) {
  PictureLayerTiling* tiling = ReadyTreeLosesLcdText();

  EXPECT_EQ(tiling, pending_layer()->HighResTiling());
}

TEST_F(DomicileLcdTextActivationTest, TheTilesAreRedoneOnceItActivates) {
  ReadyTreeLosesLcdText();
  ActivateTree();
  host_impl()->delegate()->reset_did_request_impl_side_invalidation();

  active_layer()->UpdateTiles();

  EXPECT_TRUE(host_impl()->delegate()->did_request_impl_side_invalidation());
}

}  // namespace
}  // namespace cc
