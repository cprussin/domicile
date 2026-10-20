// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/screen_choice.h"

#include <memory>

#include "base/memory/raw_ptr.h"
#include "base/memory/raw_ref.h"
#include "base/test/task_environment.h"
#include "base/test/test_future.h"
#include "content/public/browser/desktop_media_id.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/blink/public/mojom/mediastream/media_stream.mojom.h"
#include "third_party/webrtc/modules/desktop_capture/delegated_source_list_controller.h"
#include "third_party/webrtc/modules/desktop_capture/desktop_capturer.h"

namespace domicile {
namespace {

using blink::mojom::MediaStreamRequestResult;
using blink::mojom::StreamDevicesSetPtr;

// What the test sees of the portal a FakePicker stands for.
struct Portal {
  bool asked = false;
  raw_ptr<webrtc::DelegatedSourceListController::Observer> observer = nullptr;
};

// A capturer whose source list the portal shows, as webrtc's PipeWire
// capturer's is.
class FakePicker : public webrtc::DesktopCapturer,
                   public webrtc::DelegatedSourceListController {
 public:
  FakePicker(Portal& portal, SourceId source)
      : portal_(portal), source_(source) {}

  void Start(Callback* callback) override { portal_->asked = true; }
  void CaptureFrame() override {}
  bool GetSourceList(SourceList* sources) override {
    sources->push_back({source_});
    return true;
  }
  bool SelectSource(SourceId id) override { return true; }
  DelegatedSourceListController* GetDelegatedSourceListController() override {
    return this;
  }

  void Observe(Observer* observer) override { portal_->observer = observer; }
  void EnsureVisible() override {}
  void EnsureHidden() override {}

 private:
  const raw_ref<Portal> portal_;
  const SourceId source_;
};

class ScreenChoiceTest : public testing::Test {
 protected:
  base::test::SingleThreadTaskEnvironment task_environment_;
  Portal portal_;
  base::test::TestFuture<StreamDevicesSetPtr, MediaStreamRequestResult> answer_;
};

TEST_F(ScreenChoiceTest, APickAnswersWithTheSourceItsTokenIsKeptUnder) {
  ScreenChoice choice(std::make_unique<FakePicker>(portal_, 7),
                      answer_.GetCallback());
  ASSERT_TRUE(portal_.asked);

  portal_.observer->OnSelection();
  // Posted: the owner destroys the choice, and so the capturer, in the answer.
  EXPECT_FALSE(answer_.IsReady());

  const auto [devices, result] = answer_.Take();
  EXPECT_EQ(result, MediaStreamRequestResult::OK);
  ASSERT_EQ(devices->stream_devices.size(), 1u);
  EXPECT_EQ(content::DesktopMediaID::Parse(
                devices->stream_devices[0]->video_device->id),
            content::DesktopMediaID(content::DesktopMediaID::TYPE_SCREEN, 7));
}

// A refusal by the user is what a page treats as a cancel, rather than a
// share that starts and ends.
TEST_F(ScreenChoiceTest, ACancelIsTheUsersRefusal) {
  ScreenChoice choice(std::make_unique<FakePicker>(portal_, 7),
                      answer_.GetCallback());
  portal_.observer->OnCancelled();

  const auto [devices, result] = answer_.Take();
  EXPECT_EQ(result, MediaStreamRequestResult::PERMISSION_DENIED_BY_USER);
  EXPECT_TRUE(devices->stream_devices.empty());
}

TEST_F(ScreenChoiceTest, APortalErrorFailsTheVideo) {
  ScreenChoice choice(std::make_unique<FakePicker>(portal_, 7),
                      answer_.GetCallback());
  portal_.observer->OnError();

  const auto [devices, result] = answer_.Take();
  EXPECT_EQ(result, MediaStreamRequestResult::TRACK_START_FAILURE_VIDEO);
  EXPECT_TRUE(devices->stream_devices.empty());
}

}  // namespace
}  // namespace domicile
