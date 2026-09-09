// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_

#include <optional>

#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"

namespace blink {

class DomicileAppEventInit;

// Something happened to a window: it appeared, resized, closed, or asked for a
// cursor. One type for the four because they carry the same thing -- which
// window -- and differ only in what else they carry.
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
                   const String& cursor,
                   std::optional<double> width,
                   std::optional<double> height);
  ~DomicileAppEvent() override;

  const String& appId() const { return app_id_; }
  const String& title() const { return title_; }
  const String& cursor() const { return cursor_; }

  bool hasSize() const { return width_.has_value(); }
  double width() const { return width_.value_or(0); }
  double height() const { return height_.value_or(0); }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  String app_id_;
  String title_;
  String cursor_;
  std::optional<double> width_;
  std::optional<double> height_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_
