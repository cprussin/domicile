// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/site_permissions.h"

#include "base/notreached.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"

namespace domicile {

std::optional<mojom::WebViewPermission> PermissionForRequest(
    permissions::RequestType type) {
  switch (type) {
    case permissions::RequestType::kCameraStream:
      return mojom::WebViewPermission::kCamera;
    case permissions::RequestType::kMicStream:
      return mojom::WebViewPermission::kMicrophone;
    case permissions::RequestType::kGeolocation:
      return mojom::WebViewPermission::kLocation;
    case permissions::RequestType::kNotifications:
      return mojom::WebViewPermission::kNotifications;
    case permissions::RequestType::kClipboard:
      return mojom::WebViewPermission::kClipboard;
    case permissions::RequestType::kMidiSysex:
      return mojom::WebViewPermission::kMidi;
    default:
      // Many types, some per platform; none of the rest is offered.
      return std::nullopt;
  }
}

// No default arm, so a new permission fails the build.
ContentSettingsType SettingsTypeFor(mojom::WebViewPermission permission) {
  switch (permission) {
    case mojom::WebViewPermission::kCamera:
      return ContentSettingsType::MEDIASTREAM_CAMERA;
    case mojom::WebViewPermission::kMicrophone:
      return ContentSettingsType::MEDIASTREAM_MIC;
    case mojom::WebViewPermission::kLocation:
      return ContentSettingsType::GEOLOCATION;
    case mojom::WebViewPermission::kNotifications:
      return ContentSettingsType::NOTIFICATIONS;
    case mojom::WebViewPermission::kClipboard:
      return ContentSettingsType::CLIPBOARD_READ_WRITE;
    case mojom::WebViewPermission::kMidi:
      return ContentSettingsType::MIDI_SYSEX;
  }
}

mojom::WebViewPermissionSetting SettingFor(ContentSetting setting) {
  switch (setting) {
    case CONTENT_SETTING_ASK:
      return mojom::WebViewPermissionSetting::kAsk;
    case CONTENT_SETTING_ALLOW:
      return mojom::WebViewPermissionSetting::kAllow;
    case CONTENT_SETTING_BLOCK:
      return mojom::WebViewPermissionSetting::kBlock;
    default:
      NOTREACHED() << "domicile: a site permission's setting is " << setting
                   << ", which none of kSitePermissions takes.";
  }
}

ContentSetting ContentSettingFor(mojom::WebViewPermissionSetting setting) {
  switch (setting) {
    case mojom::WebViewPermissionSetting::kAsk:
      return CONTENT_SETTING_ASK;
    case mojom::WebViewPermissionSetting::kAllow:
      return CONTENT_SETTING_ALLOW;
    case mojom::WebViewPermissionSetting::kBlock:
      return CONTENT_SETTING_BLOCK;
  }
}

ContentSetting StoredSetting(mojom::WebViewPermissionSetting setting,
                             ContentSetting default_setting) {
  const ContentSetting stored = ContentSettingFor(setting);
  return stored == default_setting ? CONTENT_SETTING_DEFAULT : stored;
}

bool HasSitePermissions(const GURL& url) {
  return url.SchemeIsHTTPOrHTTPS();
}

bool IsDeviceCapture(blink::mojom::MediaStreamType audio,
                     blink::mojom::MediaStreamType video) {
  const bool audio_ok =
      audio == blink::mojom::MediaStreamType::NO_SERVICE ||
      audio == blink::mojom::MediaStreamType::DEVICE_AUDIO_CAPTURE;
  const bool video_ok =
      video == blink::mojom::MediaStreamType::NO_SERVICE ||
      video == blink::mojom::MediaStreamType::DEVICE_VIDEO_CAPTURE;
  const bool any = audio != blink::mojom::MediaStreamType::NO_SERVICE ||
                   video != blink::mojom::MediaStreamType::NO_SERVICE;
  return audio_ok && video_ok && any;
}

}  // namespace domicile
