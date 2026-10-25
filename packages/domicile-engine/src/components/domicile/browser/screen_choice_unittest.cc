// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/screen_choice.h"

#include <memory>
#include <optional>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/raw_ref.h"
#include "base/test/task_environment.h"
#include "base/test/test_future.h"
#include "components/domicile/browser/portal_picker.h"
#include "components/domicile/browser/screen_capture.h"
#include "content/public/browser/desktop_media_id.h"
#include "media/mojo/mojom/display_media_information.mojom.h"
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
  // The node the pick was given, which the desktop is asked about.
  uint32_t node = 42;
};

// A capturer whose source list the portal shows, as webrtc's PipeWire
// capturer's is.
class FakePicker : public PortalPicker,
                   public webrtc::DesktopCapturer,
                   public webrtc::DelegatedSourceListController {
 public:
  FakePicker(Portal& portal, SourceId source)
      : portal_(portal), source_(source) {}

  webrtc::DesktopCapturer& capturer() override { return *this; }
  uint32_t node() const override { return portal_->node; }

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
  // A choice for a page asking for `audio`, whose desktop says the pick is
  // `pick`. Returned by value to live on the stack: `portal_.observer` outlives
  // it, which a raw_ptr allows only of memory PartitionAlloc does not own.
  ScreenChoice Choose(std::optional<PortalPick> pick, bool audio = false) {
    return ScreenChoice(
        std::make_unique<FakePicker>(portal_, 7), audio,
        base::BindOnce(
            [](uint32_t* asked, std::optional<PortalPick> pick, uint32_t node,
               ToldWhatThePortalPicked told) {
              *asked = node;
              std::move(told).Run(std::move(pick));
            },
            base::Unretained(&asked_about_), std::move(pick)),
        base::BindOnce(
            [](std::string* asked, const std::string& window) {
              *asked = window;
              return window == "7"
                         ? TabCapture(content::WebContentsMediaCaptureId(3, 4),
                                      /*handle=*/nullptr,
                                      /*audio=*/false)
                         : StreamDevicesSetPtr();
            },
            base::Unretained(&browser_window_)),
        answer_.GetCallback());
  }

  base::test::SingleThreadTaskEnvironment task_environment_;
  Portal portal_;
  uint32_t asked_about_ = 0;
  std::string browser_window_;
  base::test::TestFuture<StreamDevicesSetPtr, MediaStreamRequestResult> answer_;
};

TEST_F(ScreenChoiceTest, APickAnswersWithTheSourceItsTokenIsKeptUnder) {
  ScreenChoice choice = Choose(std::nullopt);
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
  EXPECT_EQ(asked_about_, 42u);
}

TEST_F(ScreenChoiceTest, AWindowIsAnsweredAsAWindowWithItsSound) {
  ScreenChoice choice = Choose(
      PortalPick{.source_type = 2, .sound = "domicile-sound-window-app-3"},
      /*audio=*/true);
  portal_.observer->OnSelection();

  const auto [devices, result] = answer_.Take();
  EXPECT_EQ(result, MediaStreamRequestResult::OK);
  const blink::mojom::StreamDevices& stream = *devices->stream_devices[0];
  EXPECT_EQ(stream.video_device->display_media_info->display_surface,
            media::mojom::DisplayCaptureSurfaceType::WINDOW);
  ASSERT_TRUE(stream.audio_device.has_value());
  EXPECT_EQ(stream.audio_device->id, "domicile-sound-window-app-3");
  EXPECT_TRUE(browser_window_.empty());
}

TEST_F(ScreenChoiceTest, ABrowserWindowIsCapturedAsATab) {
  ScreenChoice choice =
      Choose(PortalPick{.source_type = 2, .browser_window = "7"});
  portal_.observer->OnSelection();

  const auto [devices, result] = answer_.Take();
  EXPECT_EQ(result, MediaStreamRequestResult::OK);
  EXPECT_EQ(browser_window_, "7");
  EXPECT_EQ(content::DesktopMediaID::Parse(
                devices->stream_devices[0]->video_device->id)
                .type,
            content::DesktopMediaID::TYPE_WEB_CONTENTS);
}

// It closed after the pick: the portal's stream of it is the answer.
TEST_F(ScreenChoiceTest, AClosedBrowserWindowIsTheScreenThePortalPicked) {
  ScreenChoice choice =
      Choose(PortalPick{.source_type = 2, .browser_window = "8"});
  portal_.observer->OnSelection();

  const auto [devices, result] = answer_.Take();
  EXPECT_EQ(content::DesktopMediaID::Parse(
                devices->stream_devices[0]->video_device->id),
            content::DesktopMediaID(content::DesktopMediaID::TYPE_SCREEN, 7));
}

// A refusal by the user is what a page treats as a cancel, rather than a
// share that starts and ends.
TEST_F(ScreenChoiceTest, ACancelIsTheUsersRefusal) {
  ScreenChoice choice = Choose(std::nullopt);
  portal_.observer->OnCancelled();

  const auto [devices, result] = answer_.Take();
  EXPECT_EQ(result, MediaStreamRequestResult::PERMISSION_DENIED_BY_USER);
  EXPECT_TRUE(devices->stream_devices.empty());
}

TEST_F(ScreenChoiceTest, APortalErrorFailsTheVideo) {
  ScreenChoice choice = Choose(std::nullopt);
  portal_.observer->OnError();

  const auto [devices, result] = answer_.Take();
  EXPECT_EQ(result, MediaStreamRequestResult::TRACK_START_FAILURE_VIDEO);
  EXPECT_TRUE(devices->stream_devices.empty());
}

}  // namespace
}  // namespace domicile
