// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SITE_PERMISSIONS_H_
#define COMPONENTS_DOMICILE_BROWSER_SITE_PERMISSIONS_H_

#include <array>
#include <optional>
#include <string_view>

#include "components/content_settings/core/common/content_settings.h"
#include "components/content_settings/core/common/content_settings_types.h"
#include "components/domicile/mojom/web_view_guest.mojom-shared.h"
#include "components/permissions/request_type.h"
#include "third_party/blink/public/mojom/mediastream/media_stream.mojom-shared.h"
#include "url/gurl.h"

namespace domicile {

// How a <webview>'s permissions map to Chrome's. The shell answers prompts and
// edits settings (see WebViewPermission in
// components/domicile/mojom/web_view_guest.mojom); these helpers need no
// browser, so they live here with their tests.

// Every permission a shell shows, in the order SitePermissionsChanged reports
// them.
inline constexpr std::array<mojom::WebViewPermission, 6> kSitePermissions = {
    mojom::WebViewPermission::kCamera,
    mojom::WebViewPermission::kMicrophone,
    mojom::WebViewPermission::kLocation,
    mojom::WebViewPermission::kNotifications,
    mojom::WebViewPermission::kClipboard,
    mojom::WebViewPermission::kMidi,
};

// The permission a prompt's request asks for, or nothing for a request no
// shell is asked about.
std::optional<mojom::WebViewPermission> PermissionForRequest(
    permissions::RequestType type);

// The content setting `permission` is stored as.
ContentSettingsType SettingsTypeFor(mojom::WebViewPermission permission);

// A stored setting as the shell sees it. `setting` must be ask, allow or
// block, which are all the kSitePermissions types take.
mojom::WebViewPermissionSetting SettingFor(ContentSetting setting);
ContentSetting ContentSettingFor(mojom::WebViewPermissionSetting setting);

// What to store for `setting` when the type defaults to `default_setting`:
// the default is stored as no exception, so the site follows it.
ContentSetting StoredSetting(mojom::WebViewPermissionSetting setting,
                             ContentSetting default_setting);

// The name a shell and the command socket give `permission`: "camera",
// "microphone", "location", "notifications", "clipboard" or "midi".
std::string_view PermissionName(mojom::WebViewPermission permission);
std::optional<mojom::WebViewPermission> PermissionNamed(std::string_view name);

// The name a shell and the command socket give `setting`: "ask", "allow" or
// "block".
std::string_view SettingName(mojom::WebViewPermissionSetting setting);
std::optional<mojom::WebViewPermissionSetting> SettingNamed(
    std::string_view name);

// Whether a page at `url` has site permissions: http, https and extension
// pages do. An extension's pages share its origin's settings, so a grant in a
// browser window holds in its action popup.
bool HasSitePermissions(const GURL& url);

// Whether a media request asks only for cameras and microphones. Other
// capture, such as of the screen, has no prompt the shell answers.
bool IsDeviceCapture(blink::mojom::MediaStreamType audio,
                     blink::mojom::MediaStreamType video);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SITE_PERMISSIONS_H_
