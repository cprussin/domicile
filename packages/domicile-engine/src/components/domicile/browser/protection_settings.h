// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_PROTECTION_SETTINGS_H_
#define COMPONENTS_DOMICILE_BROWSER_PROTECTION_SETTINGS_H_

#include "components/domicile/browser/browser_profiles.h"

class PrefService;

namespace domicile {

// Makes a profile protect as `protections` say, in Chrome's prefs, which its
// cookie settings, renderer preferences and requests follow as they change.
//
// - Third-party cookies: `profile.cookie_controls_mode`, Chrome's "Block
//   third-party cookies".
// - Global Privacy Control: Chrome's own, universal_optout's pref.
// - The local address: `webrtc.ip_handling_policy`, as
//   `default_public_interface_only`, which lets a call through on the
//   interface that reaches the internet and names no other.
// - Tracking in links: `domicile.link_tracking.remove`, which
//   LinkTrackingThrottle reads.
// - The device's details: `domicile.device_details.hide`, which
//   DeviceDetailsHiding reads.
// - Ad and tracker blocking: `domicile.ad_blocking.profile`, which a page's
//   requests are checked in unless its site or window says otherwise
//   (site_privacy.h).
void ApplyProtections(PrefService& prefs,
                      const BrowserProtections& protections);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_PROTECTION_SETTINGS_H_
