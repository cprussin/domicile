// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/protection_settings.h"

#include "components/content_settings/core/browser/cookie_settings.h"
#include "components/content_settings/core/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/universal_optout/prefs.h"

namespace domicile {
namespace {

// From chrome/common/pref_names.h, which a component cannot include.
constexpr char kWebRTCIPHandlingPolicy[] = "webrtc.ip_handling_policy";

// blink::kWebRTCIPHandlingDefault and
// blink::kWebRTCIPHandlingDefaultPublicInterfaceOnly, whose target a
// component that only sets prefs has no reason to link.
constexpr char kAnyInterface[] = "default";
constexpr char kPublicInterfaceOnly[] = "default_public_interface_only";

}  // namespace

void ApplyProtections(PrefService& prefs,
                      const BrowserProtections& protections) {
  prefs.SetInteger(
      prefs::kCookieControlsMode,
      static_cast<int>(
          protections.block_third_party_cookies
              ? content_settings::CookieControlsMode::kBlockThirdParty
              : content_settings::CookieControlsMode::kOff));
  prefs.SetBoolean(universal_optout::prefs::kUniversalOptOutEnabled,
                   protections.global_privacy_control);
  prefs.SetString(kWebRTCIPHandlingPolicy, protections.hide_local_ip_address
                                               ? kPublicInterfaceOnly
                                               : kAnyInterface);
}

}  // namespace domicile
