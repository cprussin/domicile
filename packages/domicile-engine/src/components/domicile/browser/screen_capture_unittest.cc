// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/screen_capture.h"

#include "content/public/browser/desktop_media_id.h"
#include "media/mojo/mojom/display_media_information.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/blink/public/mojom/mediastream/media_stream.mojom.h"

namespace domicile {
namespace {

using blink::mojom::MediaStreamType;

TEST(ScreenCaptureTest, OnlyGetDisplayMediaIsScreenCapture) {
  EXPECT_TRUE(IsScreenCapture(MediaStreamType::DISPLAY_VIDEO_CAPTURE));
  EXPECT_FALSE(IsScreenCapture(MediaStreamType::DEVICE_VIDEO_CAPTURE));
  EXPECT_FALSE(
      IsScreenCapture(MediaStreamType::DISPLAY_VIDEO_CAPTURE_THIS_TAB));
  EXPECT_FALSE(IsScreenCapture(MediaStreamType::NO_SERVICE));
}

TEST(ScreenCaptureTest, TheAnswerIsOneScreenThePortalPicks) {
  const blink::mojom::StreamDevicesSetPtr answer = PortalScreenCapture();

  ASSERT_EQ(answer->stream_devices.size(), 1u);
  const blink::mojom::StreamDevices& devices = *answer->stream_devices[0];
  EXPECT_FALSE(devices.audio_device.has_value());
  ASSERT_TRUE(devices.video_device.has_value());
  EXPECT_EQ(devices.video_device->type, MediaStreamType::DISPLAY_VIDEO_CAPTURE);
  // A null id carries no restore token, so the portal asks every time.
  EXPECT_EQ(content::DesktopMediaID::Parse(devices.video_device->id),
            content::DesktopMediaID(content::DesktopMediaID::TYPE_SCREEN,
                                    content::DesktopMediaID::kNullId));
  ASSERT_TRUE(devices.video_device->display_media_info);
  EXPECT_EQ(devices.video_device->display_media_info->display_surface,
            media::mojom::DisplayCaptureSurfaceType::MONITOR);
}

}  // namespace
}  // namespace domicile
