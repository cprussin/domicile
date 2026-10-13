// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_media_devices.h"

#include <algorithm>
#include <string>
#include <vector>

#include "base/strings/strcat.h"
#include "base/types/expected.h"
#include "chrome/browser/media/prefs/capture_device_ranking.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "components/domicile/browser/command_protocol.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/browser_thread.h"
#include "third_party/blink/public/common/mediastream/media_stream_request.h"

namespace domicile {
namespace {

std::vector<MediaDevice> Listed(const blink::MediaStreamDevices& devices) {
  std::vector<MediaDevice> listed;
  for (const blink::MediaStreamDevice& device : devices) {
    listed.push_back({.id = device.id, .name = device.name});
  }
  return listed;
}

}  // namespace

MediaDeviceList RankedMediaDevices(PrefService& prefs) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  MediaCaptureDevicesDispatcher* dispatcher =
      MediaCaptureDevicesDispatcher::GetInstance();
  blink::MediaStreamDevices cameras = dispatcher->GetVideoCaptureDevices();
  media_prefs::PreferenceRankVideoDeviceInfos(prefs, cameras);
  blink::MediaStreamDevices microphones = dispatcher->GetAudioCaptureDevices();
  media_prefs::PreferenceRankAudioDeviceInfos(prefs, microphones);
  MediaDeviceList list;
  list.cameras = Listed(cameras);
  list.microphones = Listed(microphones);
  return list;
}

base::expected<void, std::string> PreferMediaDevice(PrefService& prefs,
                                                    MediaDeviceKind kind,
                                                    const std::string& id) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  MediaCaptureDevicesDispatcher* dispatcher =
      MediaCaptureDevicesDispatcher::GetInstance();
  const blink::MediaStreamDevices& devices =
      kind == MediaDeviceKind::kCamera ? dispatcher->GetVideoCaptureDevices()
                                       : dispatcher->GetAudioCaptureDevices();
  const auto found =
      std::ranges::find(devices, id, &blink::MediaStreamDevice::id);
  if (found == devices.end()) {
    return base::unexpected(base::StrCat(
        {"no connected ",
         kind == MediaDeviceKind::kCamera ? "camera" : "microphone",
         " has the id \"", id, "\""}));
  }
  switch (kind) {
    case MediaDeviceKind::kCamera:
      media_prefs::UpdateVideoDevicePreferenceRanking(prefs, found, devices);
      break;
    case MediaDeviceKind::kMicrophone:
      media_prefs::UpdateAudioDevicePreferenceRanking(prefs, found, devices);
      break;
  }
  return base::ok();
}

void StartListingMediaDevices() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  // Starts the device monitor for cameras and microphones alike.
  MediaCaptureDevicesDispatcher::GetInstance()->GetVideoCaptureDevices();
}

}  // namespace domicile
