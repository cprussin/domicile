// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/frame_sink_broker.h"

#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/run_loop.h"
#include "base/test/task_environment.h"
#include "base/test/test_future.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/common/surfaces/frame_sink_id_allocator.h"
#include "components/viz/host/host_frame_sink_manager.h"
#include "components/viz/service/frame_sinks/frame_sink_manager_impl.h"
#include "components/viz/test/mock_compositor_frame_sink_client.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// The client id the browser allocates its own frame sinks from. Renderers get
// their child process id, and those start at 1, so this namespace is the
// browser's alone — see content::AllocateFrameSinkId and
// content/browser/compositor/viz_process_transport_factory.cc.
constexpr uint32_t kBrowserClientId = 0u;

}  // namespace

class FrameSinkBrokerTest : public testing::Test {
 public:
  FrameSinkBroker* broker() { return broker_.get(); }

  // Whether viz has a CompositorFrameSink for `frame_sink_id`. This is the
  // whole question the step asks: a sink exists in the viz service for a
  // producer that is not a renderer.
  bool VizHasFrameSink(const viz::FrameSinkId& frame_sink_id) {
    return frame_sink_manager_->GetFrameSinkForId(frame_sink_id) != nullptr;
  }

  void RunUntilIdle() { base::RunLoop().RunUntilIdle(); }

 protected:
  void SetUp() override {
    host_frame_sink_manager_ = std::make_unique<viz::HostFrameSinkManager>();

    // FrameSinkManagerImpl is the viz service side. In production it is in the
    // viz process; in-process here, which is what the equivalent renderer test
    // does too (embedded_frame_sink_provider_impl_unittest.cc).
    frame_sink_manager_ = std::make_unique<viz::FrameSinkManagerImpl>(
        viz::FrameSinkManagerImpl::InitParams());
    host_frame_sink_manager_->SetLocalManager(frame_sink_manager_.get());
    frame_sink_manager_->SetLocalClient(host_frame_sink_manager_.get());

    broker_ = std::make_unique<FrameSinkBroker>(
        host_frame_sink_manager_.get(),
        base::BindRepeating(
            [](viz::FrameSinkIdAllocator* allocator) {
              return allocator->NextFrameSinkId();
            },
            &allocator_));
  }

  void TearDown() override {
    broker_.reset();
    RunUntilIdle();
    frame_sink_manager_->SetLocalClient(nullptr);
    host_frame_sink_manager_.reset();
    frame_sink_manager_.reset();
  }

  // Stands in for the browser's own allocator, which is what a real embedder
  // injects.
  viz::FrameSinkIdAllocator allocator_{kBrowserClientId};

  base::test::SingleThreadTaskEnvironment task_environment_;
  std::unique_ptr<viz::HostFrameSinkManager> host_frame_sink_manager_;
  std::unique_ptr<viz::FrameSinkManagerImpl> frame_sink_manager_;
  std::unique_ptr<FrameSinkBroker> broker_;
};

// The step, stated as a test: a caller that names no FrameSinkId and belongs to
// no renderer gets one allocated and a live CompositorFrameSink bound to it.
TEST_F(FrameSinkBrokerTest, BrokersASinkToACallerThatIsNotARenderer) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;

  base::test::TestFuture<const viz::FrameSinkId&> future;
  remote->CreateFrameSink(sink_client.BindInterfaceRemote(),
                          sink.BindNewPipeAndPassReceiver(),
                          future.GetCallback());

  const viz::FrameSinkId frame_sink_id = future.Get();
  EXPECT_TRUE(frame_sink_id.is_valid());
  EXPECT_EQ(kBrowserClientId, frame_sink_id.client_id());

  RunUntilIdle();
  EXPECT_TRUE(VizHasFrameSink(frame_sink_id));
  EXPECT_TRUE(sink.is_connected());
}

// Two calls get two ids, from the injected allocator rather than a private one,
// so a brokered sink cannot collide with a browser sink.
TEST_F(FrameSinkBrokerTest, AllocatesADistinctIdPerSink) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient first_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> first_sink;
  base::test::TestFuture<const viz::FrameSinkId&> first;
  remote->CreateFrameSink(first_client.BindInterfaceRemote(),
                          first_sink.BindNewPipeAndPassReceiver(),
                          first.GetCallback());

  viz::MockCompositorFrameSinkClient second_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> second_sink;
  base::test::TestFuture<const viz::FrameSinkId&> second;
  remote->CreateFrameSink(second_client.BindInterfaceRemote(),
                          second_sink.BindNewPipeAndPassReceiver(),
                          second.GetCallback());

  EXPECT_NE(first.Get(), second.Get());

  // The id the browser's own allocator hands out next is distinct from both,
  // which is the collision the injection exists to prevent.
  const viz::FrameSinkId browser_own = allocator_.NextFrameSinkId();
  EXPECT_NE(first.Get(), browser_own);
  EXPECT_NE(second.Get(), browser_own);

  RunUntilIdle();
  EXPECT_TRUE(VizHasFrameSink(first.Get()));
  EXPECT_TRUE(VizHasFrameSink(second.Get()));
}

// A producer that closes one of its surfaces takes the sink out of viz.
TEST_F(FrameSinkBrokerTest, DestroyFrameSinkRemovesTheSinkFromViz) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  base::test::TestFuture<const viz::FrameSinkId&> future;
  remote->CreateFrameSink(sink_client.BindInterfaceRemote(),
                          sink.BindNewPipeAndPassReceiver(),
                          future.GetCallback());
  const viz::FrameSinkId frame_sink_id = future.Get();
  RunUntilIdle();
  ASSERT_TRUE(VizHasFrameSink(frame_sink_id));

  remote->DestroyFrameSink(frame_sink_id);
  RunUntilIdle();

  EXPECT_FALSE(VizHasFrameSink(frame_sink_id));
}

// A producer that goes away takes every sink it was brokered with it. Nothing
// else notices the producer died, so this is the only thing that unregisters
// the ids.
TEST_F(FrameSinkBrokerTest, DroppingTheConnectionDestroysEverySink) {
  auto remote = std::make_unique<mojo::Remote<mojom::FrameSinkBroker>>();
  broker()->Bind((*remote).BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  base::test::TestFuture<const viz::FrameSinkId&> future;
  (*remote)->CreateFrameSink(sink_client.BindInterfaceRemote(),
                             sink.BindNewPipeAndPassReceiver(),
                             future.GetCallback());
  const viz::FrameSinkId frame_sink_id = future.Get();
  RunUntilIdle();
  ASSERT_TRUE(VizHasFrameSink(frame_sink_id));

  remote.reset();
  RunUntilIdle();

  EXPECT_FALSE(VizHasFrameSink(frame_sink_id));
}

}  // namespace domicile
