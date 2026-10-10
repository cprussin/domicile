// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/site_permissions.h"

#include <optional>

#include "components/content_settings/core/common/content_settings.h"
#include "components/content_settings/core/common/content_settings_types.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "components/permissions/request_type.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/blink/public/mojom/mediastream/media_stream.mojom-shared.h"
#include "url/gurl.h"

namespace domicile {
namespace {

using blink::mojom::MediaStreamType;
using permissions::RequestType;

TEST(SitePermissionsTest, EachKindIsAskedForAsItself) {
  EXPECT_EQ(PermissionForRequest(RequestType::kCameraStream),
            mojom::WebViewPermission::kCamera);
  EXPECT_EQ(PermissionForRequest(RequestType::kMicStream),
            mojom::WebViewPermission::kMicrophone);
  EXPECT_EQ(PermissionForRequest(RequestType::kGeolocation),
            mojom::WebViewPermission::kLocation);
  EXPECT_EQ(PermissionForRequest(RequestType::kNotifications),
            mojom::WebViewPermission::kNotifications);
  EXPECT_EQ(PermissionForRequest(RequestType::kClipboard),
            mojom::WebViewPermission::kClipboard);
  EXPECT_EQ(PermissionForRequest(RequestType::kMidiSysex),
            mojom::WebViewPermission::kMidi);
}

TEST(SitePermissionsTest, ARequestTheShellHasNoKindForIsNone) {
  EXPECT_EQ(PermissionForRequest(RequestType::kWindowManagement),
            std::nullopt);
}

TEST(SitePermissionsTest, EachKindIsStoredAsItsContentSetting) {
  EXPECT_EQ(SettingsTypeFor(mojom::WebViewPermission::kCamera),
            ContentSettingsType::MEDIASTREAM_CAMERA);
  EXPECT_EQ(SettingsTypeFor(mojom::WebViewPermission::kMicrophone),
            ContentSettingsType::MEDIASTREAM_MIC);
  EXPECT_EQ(SettingsTypeFor(mojom::WebViewPermission::kLocation),
            ContentSettingsType::GEOLOCATION);
  EXPECT_EQ(SettingsTypeFor(mojom::WebViewPermission::kNotifications),
            ContentSettingsType::NOTIFICATIONS);
  EXPECT_EQ(SettingsTypeFor(mojom::WebViewPermission::kClipboard),
            ContentSettingsType::CLIPBOARD_READ_WRITE);
  EXPECT_EQ(SettingsTypeFor(mojom::WebViewPermission::kMidi),
            ContentSettingsType::MIDI_SYSEX);
}

TEST(SitePermissionsTest, EverySettingRoundTrips) {
  for (const mojom::WebViewPermissionSetting setting :
       {mojom::WebViewPermissionSetting::kAsk,
        mojom::WebViewPermissionSetting::kAllow,
        mojom::WebViewPermissionSetting::kBlock}) {
    EXPECT_EQ(SettingFor(ContentSettingFor(setting)), setting);
  }
}

TEST(SitePermissionsTest, TheDefaultIsStoredAsNoException) {
  // So a site set back to the default follows later changes to it.
  EXPECT_EQ(StoredSetting(mojom::WebViewPermissionSetting::kAsk,
                          CONTENT_SETTING_ASK),
            CONTENT_SETTING_DEFAULT);
  EXPECT_EQ(StoredSetting(mojom::WebViewPermissionSetting::kAllow,
                          CONTENT_SETTING_ALLOW),
            CONTENT_SETTING_DEFAULT);
}

TEST(SitePermissionsTest, AnythingElseIsStoredAsItself) {
  EXPECT_EQ(StoredSetting(mojom::WebViewPermissionSetting::kBlock,
                          CONTENT_SETTING_ASK),
            CONTENT_SETTING_BLOCK);
  // Notifications default to allowed (patch 0068), so asking is stored.
  EXPECT_EQ(StoredSetting(mojom::WebViewPermissionSetting::kAsk,
                          CONTENT_SETTING_ALLOW),
            CONTENT_SETTING_ASK);
}

TEST(SitePermissionsTest, OnlyWebAndExtensionPagesHaveSitePermissions) {
  EXPECT_TRUE(HasSitePermissions(GURL("https://example.com/page")));
  EXPECT_TRUE(HasSitePermissions(GURL("http://127.0.0.1:8000/")));
  EXPECT_TRUE(HasSitePermissions(
      GURL("chrome-extension://mhjfbmdgcfjbbpaeojofohoemgfcjjof/popup.html")));
  EXPECT_FALSE(HasSitePermissions(GURL("about:blank")));
  EXPECT_FALSE(HasSitePermissions(GURL("file:///home/someone/a.html")));
  EXPECT_FALSE(HasSitePermissions(GURL()));
}

TEST(SitePermissionsTest, CamerasAndMicrophonesAreDeviceCapture) {
  EXPECT_TRUE(IsDeviceCapture(MediaStreamType::DEVICE_AUDIO_CAPTURE,
                              MediaStreamType::DEVICE_VIDEO_CAPTURE));
  EXPECT_TRUE(IsDeviceCapture(MediaStreamType::NO_SERVICE,
                              MediaStreamType::DEVICE_VIDEO_CAPTURE));
  EXPECT_TRUE(IsDeviceCapture(MediaStreamType::DEVICE_AUDIO_CAPTURE,
                              MediaStreamType::NO_SERVICE));
}

TEST(SitePermissionsTest, ScreenCaptureIsNotDeviceCapture) {
  EXPECT_FALSE(IsDeviceCapture(MediaStreamType::NO_SERVICE,
                               MediaStreamType::DISPLAY_VIDEO_CAPTURE));
  EXPECT_FALSE(IsDeviceCapture(MediaStreamType::DISPLAY_AUDIO_CAPTURE,
                               MediaStreamType::DEVICE_VIDEO_CAPTURE));
  EXPECT_FALSE(
      IsDeviceCapture(MediaStreamType::NO_SERVICE, MediaStreamType::NO_SERVICE));
}

TEST(SitePermissionsTest, EachKindIsNamedAsTheShellNamesIt) {
  for (const mojom::WebViewPermission permission : kSitePermissions) {
    EXPECT_EQ(PermissionNamed(PermissionName(permission)), permission);
  }
  EXPECT_EQ(PermissionName(mojom::WebViewPermission::kLocation), "location");
  EXPECT_EQ(PermissionNamed("bluetooth"), std::nullopt);
}

TEST(SitePermissionsTest, EachSettingIsNamedAsTheShellNamesIt) {
  for (const mojom::WebViewPermissionSetting setting :
       {mojom::WebViewPermissionSetting::kAsk,
        mojom::WebViewPermissionSetting::kAllow,
        mojom::WebViewPermissionSetting::kBlock}) {
    EXPECT_EQ(SettingNamed(SettingName(setting)), setting);
  }
  EXPECT_EQ(SettingName(mojom::WebViewPermissionSetting::kBlock), "block");
  EXPECT_EQ(SettingNamed("sometimes"), std::nullopt);
}

}  // namespace
}  // namespace domicile
