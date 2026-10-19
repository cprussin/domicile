// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/screen_capture.h"

#include <optional>
#include <utility>

#include "content/public/browser/desktop_media_id.h"
#include "media/mojo/mojom/display_media_information.mojom.h"
#include "third_party/blink/public/common/mediastream/media_stream_request.h"

namespace domicile {

bool IsScreenCapture(blink::mojom::MediaStreamType video) {
  return video == blink::mojom::MediaStreamType::DISPLAY_VIDEO_CAPTURE;
}

blink::mojom::StreamDevicesSetPtr PortalScreenCapture() {
  // A null id: webrtc's PipeWire capturer keeps restore tokens by source id,
  // and null has none, so the portal asks every time.
  const content::DesktopMediaID screen(content::DesktopMediaID::TYPE_SCREEN,
                                       content::DesktopMediaID::kNullId);
  blink::MediaStreamDevice device(
      blink::mojom::MediaStreamType::DISPLAY_VIDEO_CAPTURE, screen.ToString(),
      "Screen");
  // The portal draws the pointer into the frames. The source may be a window
  // or a region; the page cannot tell which.
  device.display_media_info = media::mojom::DisplayMediaInformation::New(
      media::mojom::DisplayCaptureSurfaceType::MONITOR,
      /*logical_surface=*/true, media::mojom::CursorCaptureType::ALWAYS,
      /*capture_handle=*/nullptr, /*initial_zoom_level=*/100);

  blink::mojom::StreamDevicesSetPtr answer =
      blink::mojom::StreamDevicesSet::New();
  answer->stream_devices.push_back(blink::mojom::StreamDevices::New(
      /*audio_device=*/std::nullopt, std::move(device)));
  return answer;
}

}  // namespace domicile
