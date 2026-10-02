// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_POPUP_WINDOW_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_POPUP_WINDOW_EVENT_H_

#include <cstdint>

#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// An extension asked for a popup window of its own.
//
// THE WINDOW IS MADE, ITS TAB IS NOT. The browser has a chrome.windows window
// for it already, with no tab, and the tab is a <webview> the shell opens with
// `popupwindow` naming `windowId` -- so this, unlike DomicileNewWindowEvent,
// is not a refusal reported. windows.create answers once that <webview> has
// its guest.
//
// IN core/ RATHER THAN modules/, for DomicileNewWindowEvent's reason: the
// element that dispatches it is a core element. See
// domicile_new_window_event.h.
class CORE_EXPORT DomicilePopupWindowEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicilePopupWindowEvent(const AtomicString& type,
                           int32_t window_id,
                           const String& url,
                           int32_t width,
                           int32_t height);
  ~DomicilePopupWindowEvent() override;

  int32_t windowId() const { return window_id_; }
  const String& url() const { return url_; }
  // 0 where the extension asked for no size.
  int32_t width() const { return width_; }
  int32_t height() const { return height_; }

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  int32_t window_id_;
  String url_;
  int32_t width_;
  int32_t height_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_POPUP_WINDOW_EVENT_H_
