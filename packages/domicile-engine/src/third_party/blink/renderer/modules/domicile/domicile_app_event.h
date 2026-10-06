// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_

#include <optional>

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"

namespace blink {

class DomicileAppEventInit;

// A window lifecycle event: appeared, resized, closed, size hints, keyboard
// focus or request, or popup placed. Cursor changes use
// DomicileAppCursorEvent.
//
// The size is optional because a toplevel maps before it draws. A shell that
// read zero as a size would open the window at 0x0.
class MODULES_EXPORT DomicileAppEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileAppEvent* Create(const AtomicString& type,
                                  const DomicileAppEventInit* initializer);

  DomicileAppEvent(const AtomicString& type,
                   const DomicileAppEventInit* initializer);
  DomicileAppEvent(const AtomicString& type,
                   const String& app_id,
                   const String& title,
                   std::optional<double> width,
                   std::optional<double> height,
                   DOMHighResTimeStamp arrival);
  // A popup at (x, y) relative to `parent_app_id`'s box. Always sized: it is
  // reported after it draws.
  DomicileAppEvent(const AtomicString& type,
                   const String& app_id,
                   const String& parent_app_id,
                   double x,
                   double y,
                   double width,
                   double height,
                   bool grab,
                   DOMHighResTimeStamp arrival);
  ~DomicileAppEvent() override;

  const String& appId() const { return app_id_; }
  const String& title() const { return title_; }

  // When the browser process received the message, on `performance.now()`'s
  // clock. `timeStamp - arrival` measures the IPC to this renderer.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  bool hasSize() const { return width_.has_value(); }
  double width() const { return width_.value_or(0); }
  double height() const { return height_.value_or(0); }

  const String& parentAppId() const { return parent_app_id_; }
  double x() const { return x_; }
  double y() const { return y_; }
  bool grab() const { return grab_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  String app_id_;
  String title_;
  std::optional<double> width_;
  std::optional<double> height_;
  String parent_app_id_;
  double x_ = 0;
  double y_ = 0;
  bool grab_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_
