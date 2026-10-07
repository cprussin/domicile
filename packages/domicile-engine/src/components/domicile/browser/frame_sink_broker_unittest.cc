// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/frame_sink_broker.h"

#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

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
#include "components/viz/test/compositor_frame_helpers.h"
#include "components/viz/test/fake_host_frame_sink_client.h"
#include "components/viz/test/mock_compositor_frame_sink_client.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "testing/gmock/include/gmock/gmock.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {
namespace {

// The browser's own frame sink client id. Renderer ids start at 1. See
// content::AllocateFrameSinkId and
// content/browser/compositor/viz_process_transport_factory.cc.
constexpr uint32_t kBrowserClientId = 0u;

// The embedding page's renderer frame sink, the parent BeginFrames come from.
constexpr viz::FrameSinkId kPageFrameSinkId(1u, 1u);


// The app id `BrokerASink` passes to CreateFrameSink.
constexpr char kTestApp[] = "test-app";
constexpr gfx::Size kEmbeddedSize(320, 240);
// The page's device scale factor.
constexpr double kEmbeddedScale = 1.5;

// Fake producer observer, told which surface the embedder chose.
class FakeSurfaceObserver : public mojom::SurfaceObserver {
 public:
  mojo::PendingRemote<mojom::SurfaceObserver> BindRemote() {
    return receiver_.BindNewPipeAndPassRemote();
  }

  // mojom::SurfaceObserver implementation.
  void OnSurfaceEmbedded(const viz::LocalSurfaceId& local_surface_id,
                         const gfx::Size& size,
                         double scale) override {
    told_.push_back(local_surface_id);
    if (!embedded_.IsReady()) {
      embedded_.SetValue(local_surface_id, size, scale);
    }
  }

  // Unused here: these tests need no GPU.
  void OnFrame(int64_t deadline_us) override { frames_++; }
  void OnBufferReleased(uint64_t buffer_id) override {
    released_.push_back(buffer_id);
  }

  // The first embed.
  base::test::TestFuture<viz::LocalSurfaceId, gfx::Size, double> embedded_;
  // Every LocalSurfaceId sent, in order. The producer submits to the last.
  std::vector<viz::LocalSurfaceId> told_;
  int frames_ = 0;
  std::vector<uint64_t> released_;

 private:
  mojo::Receiver<mojom::SurfaceObserver> receiver_{this};
};

// Fake producer display observer.
class FakeDisplayListObserver : public mojom::DisplayListObserver {
 public:
  mojo::PendingRemote<mojom::DisplayListObserver> BindRemote() {
    return receiver_.BindNewPipeAndPassRemote();
  }

  // mojom::DisplayListObserver implementation.
  void OnDisplaysChanged(std::vector<mojom::DisplayPtr> displays) override {
    lists_.push_back(std::move(displays));
  }

  // Every list sent, in order. A list so tests can detect duplicates.
  std::vector<std::vector<mojom::DisplayPtr>> lists_;

 private:
  mojo::Receiver<mojom::DisplayListObserver> receiver_{this};
};

// Fake producer clipboard observer.
class FakeClipboardObserver : public mojom::ClipboardObserver {
 public:
  mojo::PendingRemote<mojom::ClipboardObserver> BindRemote() {
    return receiver_.BindNewPipeAndPassRemote();
  }

  // mojom::ClipboardObserver implementation.
  void OnCopied(mojom::Clipboard clipboard, const std::string& text) override {
    copies_.emplace_back(clipboard, text);
  }

  // Every copy sent, in order. A list so tests can detect duplicates.
  std::vector<std::pair<mojom::Clipboard, std::string>> copies_;

 private:
  mojo::Receiver<mojom::ClipboardObserver> receiver_{this};
};

// Fake producer display capture observer. These tests send no frames.
class FakeDisplayCaptureObserver : public mojom::DisplayCaptureObserver {
 public:
  mojo::PendingRemote<mojom::DisplayCaptureObserver> BindRemote() {
    return receiver_.BindNewPipeAndPassRemote();
  }

  // mojom::DisplayCaptureObserver implementation.
  void OnFrameCaptured(
      mojom::CapturedFramePtr frame,
      mojo::PendingRemote<mojom::CapturedFrameHold> hold) override {}

 private:
  mojo::Receiver<mojom::DisplayCaptureObserver> receiver_{this};
};

// One named 597x336mm panel at the origin, at just under 60Hz.
//
// Every field is nonzero so tests catch a field dropped in transit.
std::vector<mojom::DisplayPtr> OneDisplay(int64_t id, const gfx::Size& size) {
  std::vector<mojom::DisplayPtr> displays;
  displays.push_back(mojom::Display::New(id, gfx::Rect(size),
                                         gfx::Size(597, 336),
                                         "DEL DELL U3219Q 2ZLS413", 59997));
  return displays;
}

}  // namespace

class FrameSinkBrokerTest : public testing::Test {
 public:
  FrameSinkBroker* broker() { return broker_.get(); }

  // Whether viz has a CompositorFrameSink for `frame_sink_id`.
  bool VizHasFrameSink(const viz::FrameSinkId& frame_sink_id) {
    return frame_sink_manager_->GetFrameSinkForId(frame_sink_id) != nullptr;
  }

  void RunUntilIdle() { base::RunLoop().RunUntilIdle(); }

  // Whether viz has `child` registered under `parent`. The hierarchy delivers
  // BeginFrames.
  bool VizHasHierarchy(const viz::FrameSinkId& parent,
                       const viz::FrameSinkId& child) {
    return frame_sink_manager_->GetChildrenByParent(parent).contains(child);
  }

  // Allocates a LocalSurfaceId as the embedding page does. The producer never
  // allocates one.
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
    remote->CreateFrameSink(
        sink_client.BindInterfaceRemote(), sink.BindNewPipeAndPassReceiver(),
        std::move(observer), kTestApp, future.GetCallback());
    return future.Get();
  }

 protected:
  void SetUp() override {
    host_frame_sink_manager_ = std::make_unique<viz::HostFrameSinkManager>();

    // The viz service side, in-process as in
    // embedded_frame_sink_provider_impl_unittest.cc.
    frame_sink_manager_ = std::make_unique<viz::FrameSinkManagerImpl>(
        viz::FrameSinkManagerImpl::InitParams());
    host_frame_sink_manager_->SetLocalManager(frame_sink_manager_.get());
    frame_sink_manager_->SetLocalClient(host_frame_sink_manager_.get());

    // The page's frame sink, the parent for the hierarchy. The browser
    // registers it in production.
    host_frame_sink_manager_->RegisterFrameSinkId(
        kPageFrameSinkId, &page_frame_sink_client_,
        viz::ReportFirstSurfaceActivation::kNo);

    broker_ = std::make_unique<FrameSinkBroker>(
        host_frame_sink_manager_.get(),
        base::BindRepeating(
            [](viz::FrameSinkIdAllocator* allocator) {
              return allocator->NextFrameSinkId();
            },
            &allocator_),
        FrameSinkBroker::SharedImageInterfaceGetter(),
        base::BindRepeating(&FrameSinkBrokerTest::RecordLayout,
                            base::Unretained(this)),
        base::BindRepeating(&FrameSinkBrokerTest::RecordClipboard,
                            base::Unretained(this)),
        base::BindRepeating(&FrameSinkBrokerTest::CaptureTarget));
  }

  // Fake for the browser's windows: display 7's window is the page's.
  static std::optional<viz::FrameSinkId> CaptureTarget(int64_t display_id) {
    return display_id == 7 ? std::optional(kPageFrameSinkId) : std::nullopt;
  }

  // Fake for the ozone platform that owns the CRTCs.
  void RecordLayout(std::vector<mojom::DisplayLayoutPtr> layout) {
    layouts_.push_back(std::move(layout));
  }

  // Fake for the ozone platform that owns the clipboard.
  void RecordClipboard(mojom::Clipboard clipboard, const std::string& text) {
    clipboards_.emplace_back(clipboard, text);
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

  // Every layout the producer sent, in order.
  std::vector<std::vector<mojom::DisplayLayoutPtr>> layouts_;

  // Every clipboard the producer sent, in order.
  std::vector<std::pair<mojom::Clipboard, std::string>> clipboards_;

  // Fake for the browser's frame sink id allocator.
  viz::FrameSinkIdAllocator allocator_{kBrowserClientId};
  viz::ParentLocalSurfaceIdAllocator local_surface_id_allocator_;
  viz::FakeHostFrameSinkClient page_frame_sink_client_;

  base::test::SingleThreadTaskEnvironment task_environment_;
  std::unique_ptr<viz::HostFrameSinkManager> host_frame_sink_manager_;
  std::unique_ptr<viz::FrameSinkManagerImpl> frame_sink_manager_;
  std::unique_ptr<FrameSinkBroker> broker_;
};

// A non-renderer caller gets an allocated FrameSinkId and a live
// CompositorFrameSink.
TEST_F(FrameSinkBrokerTest, BrokersASinkToACallerThatIsNotARenderer) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;

  base::test::TestFuture<const viz::FrameSinkId&> future;
  remote->CreateFrameSink(sink_client.BindInterfaceRemote(),
                          sink.BindNewPipeAndPassReceiver(), mojo::NullRemote(),
                          "test-app", future.GetCallback());

  const viz::FrameSinkId frame_sink_id = future.Get();
  EXPECT_TRUE(frame_sink_id.is_valid());
  EXPECT_EQ(kBrowserClientId, frame_sink_id.client_id());

  RunUntilIdle();
  EXPECT_TRUE(VizHasFrameSink(frame_sink_id));
  EXPECT_TRUE(sink.is_connected());
}

// Ids come from the injected allocator, so they cannot collide with browser
// sinks.
TEST_F(FrameSinkBrokerTest, AllocatesADistinctIdPerSink) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient first_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> first_sink;
  base::test::TestFuture<const viz::FrameSinkId&> first;
  remote->CreateFrameSink(first_client.BindInterfaceRemote(),
                          first_sink.BindNewPipeAndPassReceiver(),
                          mojo::NullRemote(), "test-app", first.GetCallback());

  viz::MockCompositorFrameSinkClient second_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> second_sink;
  base::test::TestFuture<const viz::FrameSinkId&> second;
  remote->CreateFrameSink(second_client.BindInterfaceRemote(),
                          second_sink.BindNewPipeAndPassReceiver(),
                          mojo::NullRemote(), "test-app", second.GetCallback());

  EXPECT_NE(first.Get(), second.Get());

  // The browser's next id differs from both.
  const viz::FrameSinkId browser_own = allocator_.NextFrameSinkId();
  EXPECT_NE(first.Get(), browser_own);
  EXPECT_NE(second.Get(), browser_own);

  RunUntilIdle();
  EXPECT_TRUE(VizHasFrameSink(first.Get()));
  EXPECT_TRUE(VizHasFrameSink(second.Get()));
}

// DestroyFrameSink removes the sink from viz.
TEST_F(FrameSinkBrokerTest, DestroyFrameSinkRemovesTheSinkFromViz) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  base::test::TestFuture<const viz::FrameSinkId&> future;
  remote->CreateFrameSink(sink_client.BindInterfaceRemote(),
                          sink.BindNewPipeAndPassReceiver(), mojo::NullRemote(),
                          "test-app", future.GetCallback());
  const viz::FrameSinkId frame_sink_id = future.Get();
  RunUntilIdle();
  ASSERT_TRUE(VizHasFrameSink(frame_sink_id));

  remote->DestroyFrameSink(frame_sink_id);
  RunUntilIdle();

  EXPECT_FALSE(VizHasFrameSink(frame_sink_id));
}

// A disconnect destroys all the producer's sinks. Nothing else unregisters
// their ids.
TEST_F(FrameSinkBrokerTest, DroppingTheConnectionDestroysEverySink) {
  auto remote = std::make_unique<mojo::Remote<mojom::FrameSinkBroker>>();
  broker()->Bind((*remote).BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  base::test::TestFuture<const viz::FrameSinkId&> future;
  (*remote)->CreateFrameSink(
      sink_client.BindInterfaceRemote(), sink.BindNewPipeAndPassReceiver(),
      mojo::NullRemote(), "test-app", future.GetCallback());
  const viz::FrameSinkId frame_sink_id = future.Get();
  RunUntilIdle();
  ASSERT_TRUE(VizHasFrameSink(frame_sink_id));

  remote.reset();
  RunUntilIdle();

  EXPECT_FALSE(VizHasFrameSink(frame_sink_id));
}

// The page supplies the LocalSurfaceId and gets back the FrameSinkId, as with
// RemoteFrame.
TEST_F(FrameSinkBrokerTest, EmbedAnswersWithTheBrokeredFrameSinkId) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  const viz::FrameSinkId frame_sink_id =
      BrokerASink(remote, sink_client, sink, mojo::NullRemote());
  RunUntilIdle();

  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> embedded;
  broker()->Embed(kTestApp, kPageFrameSinkId, AllocateLocalSurfaceId(),
                  kEmbeddedSize, kEmbeddedScale, embedded.GetCallback());

  EXPECT_EQ(frame_sink_id, embedded.Get());
}

// An embed before its producer connects waits and is answered on connect.
TEST_F(FrameSinkBrokerTest, EmbedWaitsForAProducer) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> embedded;
  broker()->Embed(kTestApp, kPageFrameSinkId, AllocateLocalSurfaceId(),
                  kEmbeddedSize, kEmbeddedScale, embedded.GetCallback());
  RunUntilIdle();
  EXPECT_FALSE(embedded.IsReady());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  const viz::FrameSinkId frame_sink_id =
      BrokerASink(remote, sink_client, sink, mojo::NullRemote());

  EXPECT_EQ(frame_sink_id, embedded.Get());
}

// Each <app> element gets the surface for its own app id.
TEST_F(FrameSinkBrokerTest, EachAppEmbedsItsOwnSurface) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient terminal_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> terminal_sink;
  base::test::TestFuture<const viz::FrameSinkId&> terminal;
  remote->CreateFrameSink(terminal_client.BindInterfaceRemote(),
                          terminal_sink.BindNewPipeAndPassReceiver(),
                          mojo::NullRemote(), "terminal",
                          terminal.GetCallback());

  viz::MockCompositorFrameSinkClient editor_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> editor_sink;
  base::test::TestFuture<const viz::FrameSinkId&> editor;
  remote->CreateFrameSink(editor_client.BindInterfaceRemote(),
                          editor_sink.BindNewPipeAndPassReceiver(),
                          mojo::NullRemote(), "editor", editor.GetCallback());
  RunUntilIdle();

  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> for_terminal;
  broker()->Embed("terminal", kPageFrameSinkId, AllocateLocalSurfaceId(),
                  kEmbeddedSize, kEmbeddedScale, for_terminal.GetCallback());
  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> for_editor;
  broker()->Embed("editor", kPageFrameSinkId, AllocateLocalSurfaceId(),
                  kEmbeddedSize, kEmbeddedScale, for_editor.GetCallback());

  EXPECT_EQ(terminal.Get(), for_terminal.Get());
  EXPECT_EQ(editor.Get(), for_editor.Get());
  // The assertions above would also pass if both ids were equal.
  EXPECT_NE(for_terminal.Get(), for_editor.Get());
}

// A waiting embed is answered only by its own app's producer. On shell reload,
// several embeds wait while producers reconnect one at a time.
TEST_F(FrameSinkBrokerTest, AWaitingEmbedTakesOnlyItsOwnApp) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> for_editor;
  broker()->Embed("editor", kPageFrameSinkId, AllocateLocalSurfaceId(),
                  kEmbeddedSize, kEmbeddedScale, for_editor.GetCallback());
  RunUntilIdle();

  // The terminal connects first. The editor's element is still waiting.
  viz::MockCompositorFrameSinkClient terminal_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> terminal_sink;
  base::test::TestFuture<const viz::FrameSinkId&> terminal;
  remote->CreateFrameSink(terminal_client.BindInterfaceRemote(),
                          terminal_sink.BindNewPipeAndPassReceiver(),
                          mojo::NullRemote(), "terminal",
                          terminal.GetCallback());
  RunUntilIdle();
  EXPECT_FALSE(for_editor.IsReady())
      << "the editor's element was handed the terminal's surface";

  viz::MockCompositorFrameSinkClient editor_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> editor_sink;
  base::test::TestFuture<const viz::FrameSinkId&> editor;
  remote->CreateFrameSink(editor_client.BindInterfaceRemote(),
                          editor_sink.BindNewPipeAndPassReceiver(),
                          mojo::NullRemote(), "editor", editor.GetCallback());

  EXPECT_EQ(editor.Get(), for_editor.Get());
}

// The producer learns the embedder's LocalSurfaceId, since only the embedder
// can mint its embed_token.
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
  broker()->Embed(kTestApp, kPageFrameSinkId, local_surface_id,
                  kEmbeddedSize, kEmbeddedScale, embedded.GetCallback());

  EXPECT_EQ(local_surface_id, observer.embedded_.Get<viz::LocalSurfaceId>());
  EXPECT_EQ(kEmbeddedSize, observer.embedded_.Get<gfx::Size>());
  // Each monitor's page has its own scale.
  EXPECT_EQ(kEmbeddedScale, observer.embedded_.Get<double>());
}

// Two <app> elements showing one window share its allocator but use separate
// pipes, so an older LocalSurfaceId can arrive late. Submitting to it would
// make viz close the sink, and the window would stop drawing.
TEST_F(FrameSinkBrokerTest, AnOlderSurfaceArrivingLateIsNotPassedOn) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  FakeSurfaceObserver observer;
  testing::NiceMock<viz::MockCompositorFrameSinkClient> sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  BrokerASink(remote, sink_client, sink, observer.BindRemote());
  RunUntilIdle();

  const viz::LocalSurfaceId older = AllocateLocalSurfaceId();
  const viz::LocalSurfaceId newer = AllocateLocalSurfaceId();

  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> for_newer;
  broker()->Embed(kTestApp, kPageFrameSinkId, newer, kEmbeddedSize,
                  kEmbeddedScale, for_newer.GetCallback());
  ASSERT_TRUE(for_newer.Wait());
  RunUntilIdle();
  sink->SubmitCompositorFrame(observer.told_.back(),
                              viz::MakeDefaultCompositorFrame(), std::nullopt,
                              0);

  // The late embed is still answered: the element needs a FrameSinkId.
  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> for_older;
  broker()->Embed(kTestApp, kPageFrameSinkId, older, kEmbeddedSize,
                  kEmbeddedScale, for_older.GetCallback());
  ASSERT_TRUE(for_older.Wait());
  RunUntilIdle();
  sink->SubmitCompositorFrame(observer.told_.back(),
                              viz::MakeDefaultCompositorFrame(), std::nullopt,
                              0);
  RunUntilIdle();

  EXPECT_EQ(newer, observer.told_.back());
  EXPECT_TRUE(sink.is_connected());
}

// Embedding registers the producer under the page so BeginFrames arrive.
// Before an embed, there is no parent.
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
  broker()->Embed(kTestApp, kPageFrameSinkId, AllocateLocalSurfaceId(),
                  kEmbeddedSize, kEmbeddedScale, embedded.GetCallback());
  ASSERT_TRUE(embedded.Wait());
  RunUntilIdle();

  EXPECT_TRUE(VizHasHierarchy(kPageFrameSinkId, frame_sink_id));
}

// Destroying a sink also unregisters it from the hierarchy.
TEST_F(FrameSinkBrokerTest, DestroyingTheSinkUnregistersTheHierarchy) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  viz::MockCompositorFrameSinkClient sink_client;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink;
  const viz::FrameSinkId frame_sink_id =
      BrokerASink(remote, sink_client, sink, mojo::NullRemote());
  base::test::TestFuture<const std::optional<viz::FrameSinkId>&> embedded;
  broker()->Embed(kTestApp, kPageFrameSinkId, AllocateLocalSurfaceId(),
                  kEmbeddedSize, kEmbeddedScale, embedded.GetCallback());
  ASSERT_TRUE(embedded.Wait());
  RunUntilIdle();
  ASSERT_TRUE(VizHasHierarchy(kPageFrameSinkId, frame_sink_id));

  remote->DestroyFrameSink(frame_sink_id);
  RunUntilIdle();

  EXPECT_FALSE(VizHasHierarchy(kPageFrameSinkId, frame_sink_id));
}

TEST_F(FrameSinkBrokerTest, AnObserverIsToldTheDisplaysAlreadyRead) {
  // On a tty the browser reads displays before the compositor connects.
  // Without this, the compositor would wait for a hotplug.
  broker()->OnDisplaysChanged(OneDisplay(7, gfx::Size(2880, 1920)));

  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());
  FakeDisplayListObserver observer;
  remote->ObserveDisplays(observer.BindRemote());
  RunUntilIdle();

  ASSERT_EQ(observer.lists_.size(), 1u);
  ASSERT_EQ(observer.lists_[0].size(), 1u);
  EXPECT_EQ(observer.lists_[0][0]->id, 7);
  EXPECT_EQ(observer.lists_[0][0]->bounds, gfx::Rect(2880, 1920));
  EXPECT_EQ(observer.lists_[0][0]->physical_size_mm, gfx::Size(597, 336));
  EXPECT_EQ(observer.lists_[0][0]->name, "DEL DELL U3219Q 2ZLS413");
  EXPECT_EQ(observer.lists_[0][0]->refresh_mhz, 59997);
}

TEST_F(FrameSinkBrokerTest, AProducerSaysWhichConnectorsToLight) {
  // The browser reads displays from DRM; only the producer has the config
  // that says how to lay them out.
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  std::vector<mojom::DisplayLayoutPtr> layout;
  layout.push_back(mojom::DisplayLayout::New(
      7, true, gfx::Point(1920, 0), mojom::DisplayTransform::kRotate270, 1.2,
      gfx::Rect(1920, 0, 1800, 3200)));
  layout.push_back(mojom::DisplayLayout::New(
      9, false, gfx::Point(), mojom::DisplayTransform::kNormal, 1.0,
      gfx::Rect()));
  remote->ConfigureDisplays(std::move(layout));
  RunUntilIdle();

  ASSERT_EQ(layouts_.size(), 1u);
  ASSERT_EQ(layouts_[0].size(), 2u);
  EXPECT_EQ(layouts_[0][0]->id, 7);
  EXPECT_TRUE(layouts_[0][0]->enabled);
  EXPECT_EQ(layouts_[0][0]->origin, gfx::Point(1920, 0));
  // The rotation and scale the window is drawn at.
  EXPECT_EQ(layouts_[0][0]->transform, mojom::DisplayTransform::kRotate270);
  EXPECT_EQ(layouts_[0][0]->scale, 1.2);
  // The position in the desk layout, used for pointer movement.
  EXPECT_EQ(layouts_[0][0]->desk, gfx::Rect(1920, 0, 1800, 3200));
  EXPECT_EQ(layouts_[0][1]->id, 9);
  EXPECT_FALSE(layouts_[0][1]->enabled);
}

TEST_F(FrameSinkBrokerTest, AProducerWithNoOpinionSaysSoRatherThanNothing) {
  // An empty layout means "no profile matched" and must be forwarded: it
  // restores panels that a previous profile turned off.
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  remote->ConfigureDisplays({});
  RunUntilIdle();

  ASSERT_EQ(layouts_.size(), 1u);
  EXPECT_TRUE(layouts_[0].empty());
}

TEST_F(FrameSinkBrokerTest, AnEmbedderWithNoCrtcDropsTheLayout) {
  // Outside a tty there are no connectors. The producer cannot tell, so it
  // sends a layout anyway.
  FrameSinkBroker unwired(host_frame_sink_manager_.get(),
                          base::BindRepeating(
                              [](viz::FrameSinkIdAllocator* allocator) {
                                return allocator->NextFrameSinkId();
                              },
                              &allocator_));
  mojo::Remote<mojom::FrameSinkBroker> remote;
  unwired.Bind(remote.BindNewPipeAndPassReceiver());

  std::vector<mojom::DisplayLayoutPtr> layout;
  layout.push_back(mojom::DisplayLayout::New(
      7, true, gfx::Point(), mojom::DisplayTransform::kNormal, 1.0,
      gfx::Rect()));
  remote->ConfigureDisplays(std::move(layout));
  RunUntilIdle();

  EXPECT_TRUE(layouts_.empty()) << "the fixture's own broker heard nothing";
}

TEST_F(FrameSinkBrokerTest, AProducerSaysWhatIsOnEachClipboard) {
  // Lets a copy in a Wayland client be pasted in a page. The copy and primary
  // clipboards must stay separate.
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  remote->SetClipboard(mojom::Clipboard::kCopy, "an explicit copy");
  remote->SetClipboard(mojom::Clipboard::kPrimary, "brushed past");
  RunUntilIdle();

  ASSERT_EQ(clipboards_.size(), 2u);
  EXPECT_EQ(clipboards_[0].first, mojom::Clipboard::kCopy);
  EXPECT_EQ(clipboards_[0].second, "an explicit copy");
  EXPECT_EQ(clipboards_[1].first, mojom::Clipboard::kPrimary);
  EXPECT_EQ(clipboards_[1].second, "brushed past");
}

TEST_F(FrameSinkBrokerTest, AnEmptyClipboardIsSaidRatherThanSwallowed) {
  // Forwarded so the browser stops pasting cleared content.
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());

  remote->SetClipboard(mojom::Clipboard::kCopy, "");
  RunUntilIdle();

  ASSERT_EQ(clipboards_.size(), 1u);
  EXPECT_EQ(clipboards_[0].second, "");
}

TEST_F(FrameSinkBrokerTest, AnEmbedderWithNoClipboardDropsWhatWasSaid) {
  // Inside another session, the browser reads that session's clipboard. The
  // producer cannot tell, so it sends its clipboard anyway.
  FrameSinkBroker unwired(host_frame_sink_manager_.get(),
                          base::BindRepeating(
                              [](viz::FrameSinkIdAllocator* allocator) {
                                return allocator->NextFrameSinkId();
                              },
                              &allocator_));
  mojo::Remote<mojom::FrameSinkBroker> remote;
  unwired.Bind(remote.BindNewPipeAndPassReceiver());

  remote->SetClipboard(mojom::Clipboard::kCopy, "an explicit copy");
  RunUntilIdle();

  EXPECT_TRUE(clipboards_.empty()) << "the fixture's own broker heard nothing";
}

TEST_F(FrameSinkBrokerTest, ACopyMadeInTheBrowserReachesEveryObserver) {
  // The browser is not a Wayland client of the producer, so this is the only
  // way a copy in a page reaches the seat.
  mojo::Remote<mojom::FrameSinkBroker> first_remote;
  mojo::Remote<mojom::FrameSinkBroker> second_remote;
  broker()->Bind(first_remote.BindNewPipeAndPassReceiver());
  broker()->Bind(second_remote.BindNewPipeAndPassReceiver());
  FakeClipboardObserver first;
  FakeClipboardObserver second;
  first_remote->ObserveClipboard(first.BindRemote());
  second_remote->ObserveClipboard(second.BindRemote());
  RunUntilIdle();

  broker()->OnCopied(mojom::Clipboard::kPrimary, "copied in a page");
  RunUntilIdle();

  ASSERT_EQ(first.copies_.size(), 1u);
  EXPECT_EQ(first.copies_[0].first, mojom::Clipboard::kPrimary);
  EXPECT_EQ(first.copies_[0].second, "copied in a page");
  EXPECT_EQ(second.copies_, first.copies_);
}

TEST_F(FrameSinkBrokerTest, AnObserverIsNotCaughtUpOnCopiesItMissed) {
  // Unlike displays, copies are not replayed: the producer owns the clipboard
  // state and sets it with SetClipboard.
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());
  broker()->OnCopied(mojom::Clipboard::kCopy, "copied before it connected");

  FakeClipboardObserver observer;
  remote->ObserveClipboard(observer.BindRemote());
  RunUntilIdle();

  EXPECT_TRUE(observer.copies_.empty());
}

TEST_F(FrameSinkBrokerTest, AnObserverHearsNothingUntilTheDisplaysAreRead) {
  // An empty list means the screen is unread, so nothing is sent.
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());
  FakeDisplayListObserver observer;
  remote->ObserveDisplays(observer.BindRemote());
  RunUntilIdle();

  EXPECT_TRUE(observer.lists_.empty());

  broker()->OnDisplaysChanged(OneDisplay(7, gfx::Size(2880, 1920)));
  RunUntilIdle();

  ASSERT_EQ(observer.lists_.size(), 1u);
  EXPECT_EQ(observer.lists_[0][0]->bounds, gfx::Rect(2880, 1920));
}

TEST_F(FrameSinkBrokerTest, AHotplugReachesEveryObserver) {
  mojo::Remote<mojom::FrameSinkBroker> first_remote;
  broker()->Bind(first_remote.BindNewPipeAndPassReceiver());
  FakeDisplayListObserver first;
  first_remote->ObserveDisplays(first.BindRemote());

  mojo::Remote<mojom::FrameSinkBroker> second_remote;
  broker()->Bind(second_remote.BindNewPipeAndPassReceiver());
  FakeDisplayListObserver second;
  second_remote->ObserveDisplays(second.BindRemote());
  RunUntilIdle();

  broker()->OnDisplaysChanged(OneDisplay(7, gfx::Size(1920, 1080)));
  RunUntilIdle();

  ASSERT_EQ(first.lists_.size(), 1u);
  ASSERT_EQ(second.lists_.size(), 1u);
  EXPECT_EQ(first.lists_[0][0]->bounds, gfx::Rect(1920, 1080));
  EXPECT_EQ(second.lists_[0][0]->bounds, gfx::Rect(1920, 1080));
}

TEST_F(FrameSinkBrokerTest, ADisplayWithAWindowIsCaptured) {
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());
  FakeDisplayCaptureObserver observer;
  mojo::Remote<mojom::DisplayCapture> capture;

  base::test::TestFuture<bool> started;
  remote->CaptureDisplay(7, gfx::Size(1920, 1080), 30,
                         capture.BindNewPipeAndPassReceiver(),
                         observer.BindRemote(), started.GetCallback());

  EXPECT_TRUE(started.Get());
  RunUntilIdle();
  EXPECT_TRUE(capture.is_connected());
}

TEST_F(FrameSinkBrokerTest, ADisplayWithNoWindowIsRefused) {
  // As while a new monitor's window opens.
  mojo::Remote<mojom::FrameSinkBroker> remote;
  broker()->Bind(remote.BindNewPipeAndPassReceiver());
  FakeDisplayCaptureObserver observer;
  mojo::Remote<mojom::DisplayCapture> capture;

  base::test::TestFuture<bool> started;
  remote->CaptureDisplay(8, gfx::Size(1920, 1080), 30,
                         capture.BindNewPipeAndPassReceiver(),
                         observer.BindRemote(), started.GetCallback());

  EXPECT_FALSE(started.Get());
  RunUntilIdle();
  EXPECT_FALSE(capture.is_connected());
}

}  // namespace domicile
