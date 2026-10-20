// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SCREEN_CAPTURE_H_
#define COMPONENTS_DOMICILE_BROWSER_SCREEN_CAPTURE_H_

#include "content/public/browser/desktop_media_id.h"
#include "third_party/blink/public/mojom/mediastream/media_stream.mojom.h"

namespace domicile {

// Whether a media request asking for `video` is a page's `getDisplayMedia()`.
bool IsScreenCapture(blink::mojom::MediaStreamType video);

// The answer to a page's `getDisplayMedia()` once the desktop's ScreenCast
// portal picked a window, a monitor or a region (see ScreenChoice): one screen
// and no audio.
//
// `source` is the webrtc source id the pick's restore token is kept under.
// The capture selects it, so its own portal session restores the pick rather
// than asking again. See content::desktop_capture::CreateScreenCapturer.
blink::mojom::StreamDevicesSetPtr PortalScreenCapture(
    content::DesktopMediaID::Id source);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SCREEN_CAPTURE_H_
