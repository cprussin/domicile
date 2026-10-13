// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_MEDIA_DEVICES_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_MEDIA_DEVICES_H_

#include <string>

#include "base/types/expected.h"
#include "components/domicile/browser/command_protocol.h"

class PrefService;

namespace domicile {

// The camera and microphone a page gets when it names none: Chrome's device
// ranking in a profile's prefs. The Settings app reaches it through the
// command socket, and the shell through a <webview>.

// The cameras and microphones, ranked by `prefs` as Chrome ranks them for a
// page that names no device
// (MediaCaptureDevicesDispatcher::GetPreferredVideoDeviceForBrowserContext).
MediaDeviceList RankedMediaDevices(PrefService& prefs);

// Ranks device `id` above every other connected device of its kind, as
// Chrome's own camera and microphone settings do, or says why not.
base::expected<void, std::string> PreferMediaDevice(PrefService& prefs,
                                                    MediaDeviceKind kind,
                                                    const std::string& id);

// Starts Chrome listing devices. It lists them only once something asks, and
// the list arrives later, so asking at startup means the first listing finds
// them.
void StartListingMediaDevices();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_MEDIA_DEVICES_H_
