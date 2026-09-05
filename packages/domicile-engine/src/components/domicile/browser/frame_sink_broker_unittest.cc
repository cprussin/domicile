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
#include "components/viz/common/surfaces/local_surface_id.h"
#include "components/viz/common/surfaces/parent_local_surface_id_allocator.h"
#include "components/viz/host/host_frame_sink_manager.h"
#include "components/viz/service/frame_sinks/frame_sink_manager_impl.h"
#include "components/viz/test/fake_host_frame_sink_client.h"
#include "components/viz/test/mock_compositor_frame_sink_client.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {
namespace {

// The client id the browser allocates its own frame sinks from. Renderers get
// their child process id, and those start at 1, so this namespace is the
// browser's alone — see content::AllocateFrameSinkId and
// content/browser/compositor/viz_process_transport_factory.cc.
constexpr uint32_t kBrowserClientId = 0u;

// The FrameSinkId a page embeds under: its own renderer's, which is the parent
// BeginFrames travel down from. Client id 1 because a renderer's is its child
// process id and those start at 1.
constexpr viz::FrameSinkId kPageFrameSinkId(1u, 1u);

constexpr gfx::Size kEmbeddedSize(320, 240);

// Stands in for the producer's half: the callback that tells it which surface
// the embedder chose for it.
class FakeSurfaceObserver : public mojom::SurfaceObserver {
 public:
  mojo::PendingRemote<mojom::SurfaceObserver> BindRemote() {
    return receiver_.BindNewPipeAndPassRemote();
  }

  // mojom::SurfaceObserver implementation.
  void OnSurfaceEmbedded(const viz::LocalSurfaceId& local_surface_id,
                         const gfx::Size& size) override {
    embedded_.SetValue(local_surface_id, size);
  }

  base::test::TestFuture<viz::LocalSurfaceId, gfx::Size> embedded_;

 private:
  mojo::Receiver<mojom::SurfaceObserver> receiver_{this};
};

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

  // Whether viz has `child` registered as a child of `parent`. Hierarchy is
  // what makes BeginFrames arrive; step 2 established it is not what gets the
  // surface drawn.
  bool VizHasHierarchy(const viz::FrameSinkId& parent,
                       const viz::FrameSinkId& child) {
    return frame_sink_manager_->GetChildrenByParent(parent).contains(child);
  }

  // Allocates a LocalSurfaceId the way an embedder does. The page runs this
  // allocator in production; the point is that the producer never does.
  viz::LocalSurfaceId AllocateLocalSurfaceId() {
    local_surface_id_allocator_.GenerateId();
    return local_surface_id_allocator_.GetCurrentLocalSurfaceId();
  }

  // Brokers a sink to `observer` and returns its id, leaving `sink` bound.
  viz::FrameSinkId BrokerASink(
      mojo::Remote<mojom::FrameSinkBroker>& remote,
      viz::MockCompositorFrameSinkClient& sink_client,
      mojo::Remote<viz::mojom::CompositorFrameSink>& sink,
      mojo::PendingRemote<mojom::SurfaceObserver> observer) {
    base::test::TestFuture<const viz::FrameSinkId&> future;
    remote->CreateFrameSink(sink_client.BindInterfaceRemote(),
                            sink.BindNewPipeAndPassReceiver(),
                            std::move(observer), future.GetCallback());
    return future.Get();
  }

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

    // The page's own frame sink. Registering it is the browser's job in
    // production; without it there is no parent for a hierarchy to hang off.
    host_frame_sink_manager_->RegisterFrameSinkId(
        kPageFrameSinkId, &page_frame_sink_client_,
        viz::ReportFirstSurfaceActivation::kNo);

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
    host_frame_sink_manager_->InvalidateFrameSinkId(
        kPageFrameSinkId, &page_frame_sink_client_, {});
    frame_sink_manager_->SetLocalClient(nullptr);
    host_frame_sink_manager_.reset();
    frame_sink_manager_.reset();
  }

  // Stands in for the browser's own allocator, which is what a real embedder
  // injects.
  viz::FrameSinkIdAllocator allocator_{kBrowserClientId};
  viz::ParentLocalSurfaceIdAllocator local_surface_id_allocator_;
  viz::FakeHostFrameSinkClient page_frame_sink_client_;

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
                          mojo::NullRemote(), future.GetCallback());

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
                          mojo::NullRemote(), first.GetCallback());

  viz::MockCompositorFrameSinkClient second_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> second_sink;
  base::test::TestFuture<const viz::FrameSinkId&> second;
  remote->CreateFrameSink(second_client.BindInterfaceRemote(),
                          second_sink.BindNewPipeAndPassReceiver(),
                          mojo::NullRemote(), second.GetCallback());

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
                          mojo::NullRemote(), future.GetCallback());
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
                             mojo::NullRemote(), future.GetCallback());
  const viz::FrameSinkId frame_sink_id = future.Get();
  RunUntilIdle();
  ASSERT_TRUE(VizHasFrameSink(frame_sink_id));

  remote.reset();
  RunUntilIdle();

  EXPECT_FALSE(VizHasFrameSink(frame_sink_id));
}

// Step 3, stated as a test: the page brings a LocalSurfaceId it allocated
// itself and gets back the FrameSinkId to pair it with. The two halves of the
// SurfaceId come from opposite sides, which is the split RemoteFrame uses.
TEST_F(FrameSinkBrokerTest, EmbedAnswersWithTheBrokeredFrameSinkId) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  const viz::FrameSinkId frame_sink_id =
      BrokerASink(remote, sink_client, sink, mojo::NullRemote());
  RunUntilIdle();

  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> embedded;
  broker()->Embed(kPageFrameSinkId, AllocateLocalSurfaceId(), kEmbeddedSize,
                  embedded.GetCallback());

  EXPECT_EQ(frame_sink_id, embedded.Get());
}

// An <app> element exists before the window behind it does. A page that embeds
// before any producer has connected waits rather than failing, and is answered
// when one turns up.
TEST_F(FrameSinkBrokerTest, EmbedWaitsForAProducer) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> embedded;
  broker()->Embed(kPageFrameSinkId, AllocateLocalSurfaceId(), kEmbeddedSize,
                  embedded.GetCallback());
  RunUntilIdle();
  EXPECT_FALSE(embedded.IsReady());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  const viz::FrameSinkId frame_sink_id =
      BrokerASink(remote, sink_client, sink, mojo::NullRemote());

  EXPECT_EQ(frame_sink_id, embedded.Get());
}

// The other direction of the same exchange: the producer is told which
// LocalSurfaceId the embedder allocated for it, because it cannot invent one —
// the embed_token in it is the embedder's to mint and the producer's to adopt.
TEST_F(FrameSinkBrokerTest, EmbedTellsTheProducerWhichSurfaceToSubmitTo) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  FakeSurfaceObserver observer;
  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  BrokerASink(remote, sink_client, sink, observer.BindRemote());
  RunUntilIdle();

  const viz::LocalSurfaceId local_surface_id = AllocateLocalSurfaceId();
  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> embedded;
  broker()->Embed(kPageFrameSinkId, local_surface_id, kEmbeddedSize,
                  embedded.GetCallback());

  EXPECT_EQ(local_surface_id, observer.embedded_.Get<0>());
  EXPECT_EQ(kEmbeddedSize, observer.embedded_.Get<1>());
}

// Embedding is also what puts the producer under the page in the frame sink
// hierarchy, which is what makes BeginFrames arrive. Nothing could do this
// earlier: until a page embeds, there is no parent to name.
TEST_F(FrameSinkBrokerTest, EmbedRegistersTheHierarchyUnderThePage) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  const viz::FrameSinkId frame_sink_id =
      BrokerASink(remote, sink_client, sink, mojo::NullRemote());
  RunUntilIdle();
  ASSERT_FALSE(VizHasHierarchy(kPageFrameSinkId, frame_sink_id));

  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> embedded;
  broker()->Embed(kPageFrameSinkId, AllocateLocalSurfaceId(), kEmbeddedSize,
                  embedded.GetCallback());
  ASSERT_TRUE(embedded.Wait());
  RunUntilIdle();

  EXPECT_TRUE(VizHasHierarchy(kPageFrameSinkId, frame_sink_id));
}

// A producer that goes away unregisters the hierarchy as well as the sink,
// leaving the page's frame sink with no dangling child.
TEST_F(FrameSinkBrokerTest, DestroyingTheSinkUnregistersTheHierarchy) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  const viz::FrameSinkId frame_sink_id =
      BrokerASink(remote, sink_client, sink, mojo::NullRemote());
  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> embedded;
  broker()->Embed(kPageFrameSinkId, AllocateLocalSurfaceId(), kEmbeddedSize,
                  embedded.GetCallback());
  ASSERT_TRUE(embedded.Wait());
  RunUntilIdle();
  ASSERT_TRUE(VizHasHierarchy(kPageFrameSinkId, frame_sink_id));

  remote->DestroyFrameSink(frame_sink_id);
  RunUntilIdle();

  EXPECT_FALSE(VizHasHierarchy(kPageFrameSinkId, frame_sink_id));
}

}  // namespace domicile
