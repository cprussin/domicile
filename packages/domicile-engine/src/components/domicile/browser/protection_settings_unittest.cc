// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/protection_settings.h"

#include "components/content_settings/core/browser/cookie_settings.h"
#include "components/content_settings/core/common/pref_names.h"
#include "components/domicile/browser/site_privacy.h"
#include "components/prefs/pref_registry_simple.h"
#include "components/prefs/testing_pref_service.h"
#include "components/universal_optout/prefs.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

constexpr char kWebRTCIPHandlingPolicy[] = "webrtc.ip_handling_policy";

// Registers each pref as a fresh Chromium profile has it: third-party
// cookies allowed, no Global Privacy Control, WebRTC on every interface.
class ProtectionSettingsTest : public testing::Test {
 protected:
  ProtectionSettingsTest() {
    prefs_.registry()->RegisterIntegerPref(
        prefs::kCookieControlsMode,
        static_cast<int>(content_settings::CookieControlsMode::kOff));
    prefs_.registry()->RegisterBooleanPref(
        universal_optout::prefs::kUniversalOptOutEnabled, false);
    prefs_.registry()->RegisterStringPref(kWebRTCIPHandlingPolicy, "default");
    RegisterSitePrivacyPrefs(prefs_.registry());
  }

  TestingPrefServiceSimple prefs_;
};

TEST_F(ProtectionSettingsTest, EveryProtectionOnSetsChromesOwnPrefs) {
  ApplyProtections(prefs_, BrowserProtections{});
  EXPECT_EQ(
      prefs_.GetInteger(prefs::kCookieControlsMode),
      static_cast<int>(content_settings::CookieControlsMode::kBlockThirdParty));
  EXPECT_TRUE(
      prefs_.GetBoolean(universal_optout::prefs::kUniversalOptOutEnabled));
  EXPECT_EQ(prefs_.GetString(kWebRTCIPHandlingPolicy),
            "default_public_interface_only");
  EXPECT_TRUE(prefs_.GetBoolean(kRemoveLinkTrackingPref));
  EXPECT_TRUE(prefs_.GetBoolean(kHideDeviceDetailsPref));
  EXPECT_EQ(ProfileAdBlocking(prefs_), AdBlockingMode::kStandard);
}

TEST_F(ProtectionSettingsTest, AProtectionTurnedOffPutsChromesDefaultBack) {
  ApplyProtections(prefs_, BrowserProtections{});
  ApplyProtections(prefs_, BrowserProtections{
                               .block_third_party_cookies = false,
                               .global_privacy_control = false,
                               .hide_local_ip_address = false,
                               .remove_tracking_from_links = false,
                               .hide_device_details = false,
                               .block_ads_and_trackers = AdBlockingMode::kOff,
                           });
  EXPECT_EQ(prefs_.GetInteger(prefs::kCookieControlsMode),
            static_cast<int>(content_settings::CookieControlsMode::kOff));
  EXPECT_FALSE(
      prefs_.GetBoolean(universal_optout::prefs::kUniversalOptOutEnabled));
  EXPECT_EQ(prefs_.GetString(kWebRTCIPHandlingPolicy), "default");
  EXPECT_FALSE(prefs_.GetBoolean(kRemoveLinkTrackingPref));
  EXPECT_FALSE(prefs_.GetBoolean(kHideDeviceDetailsPref));
  EXPECT_EQ(ProfileAdBlocking(prefs_), AdBlockingMode::kOff);
}

}  // namespace
}  // namespace domicile
