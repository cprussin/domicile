// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_PORTAL_PICKER_H_
#define COMPONENTS_DOMICILE_BROWSER_PORTAL_PICKER_H_

#include <cstdint>
#include <memory>
#include <optional>

#include "base/functional/callback.h"
#include "components/domicile/browser/screen_capture.h"
#include "third_party/webrtc/modules/desktop_capture/desktop_capturer.h"

namespace dbus {
class Response;
}

namespace domicile {

// The desktop's ScreenCast portal picker for a page's `getDisplayMedia()`:
// webrtc's PipeWire capturer, whose delegated source list it is, and the
// PipeWire node of the stream the pick was given. See ScreenChoice.
class PortalPicker {
 public:
  virtual ~PortalPicker() = default;

  virtual webrtc::DesktopCapturer& capturer() = 0;

  // The pick's stream node, once the portal answered with one.
  virtual uint32_t node() const = 0;
};

// The picker, as content's screen capturer makes it.
std::unique_ptr<PortalPicker> MakePortalPicker();

// Asks the compositor what node `node`'s portal stream shows, with its
// `org.domicile.ScreenCast.Pick`. webrtc gives the engine the node alone.
// `told` runs on this sequence, with nullopt when the desktop cannot say, as
// another portal cannot.
using ToldWhatThePortalPicked =
    base::OnceCallback<void(std::optional<PortalPick>)>;
void AskWhatThePortalPicked(uint32_t node, ToldWhatThePortalPicked told);

// `Pick`'s reply, or nullopt for an error or a reply of another shape.
std::optional<PortalPick> ReadPortalPick(dbus::Response* response);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_PORTAL_PICKER_H_
