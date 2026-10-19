// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SCREEN_CAPTURE_H_
#define COMPONENTS_DOMICILE_BROWSER_SCREEN_CAPTURE_H_

#include "third_party/blink/public/mojom/mediastream/media_stream.mojom.h"

namespace domicile {

// Whether a media request asking for `video` is a page's `getDisplayMedia()`.
bool IsScreenCapture(blink::mojom::MediaStreamType video);

// The answer to a page's `getDisplayMedia()`: one screen and no audio.
//
// The desktop's ScreenCast portal picks the source when capture starts, in the
// shell's picker: a window, a monitor or a region. See
// content::desktop_capture::CreateScreenCapturer.
blink::mojom::StreamDevicesSetPtr PortalScreenCapture();

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SCREEN_CAPTURE_H_
