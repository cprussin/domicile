// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_

#include <optional>

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"

namespace blink {

class DomicileAppEventInit;

// Something happened to a window: it appeared, resized or closed, or the
// keyboard moved to it or was asked for by it. One type for the five because
// they carry the same thing -- which window -- and differ only in what else
// they carry.
//
// A cursor is NOT one of them, and used to be. See DomicileAppCursorEvent:
// what a client asks to be shown is a `DomicileCursorShape`, and a closed set
// has no member to mean "this event is not about a cursor".
//
// `size` is genuinely optional rather than zero-when-absent. A toplevel maps
// before it draws, so a window that has appeared may not yet have said how big
// it wants to be, and a shell that reads a zero as a size opens the window at
// nothing at all. Absence is carried so it cannot be mistaken for a number.
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
  ~DomicileAppEvent() override;

  const String& appId() const { return app_id_; }
  const String& title() const { return title_; }

  // When the browser process had this, on `performance.now()`'s clock.
  // `timeStamp` is when this object was constructed at dispatch; the
  // difference is the stage between the compositor's socket and this page.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  bool hasSize() const { return width_.has_value(); }
  double width() const { return width_.value_or(0); }
  double height() const { return height_.value_or(0); }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  String app_id_;
  String title_;
  std::optional<double> width_;
  std::optional<double> height_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_
