// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_THEME_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_THEME_EVENT_H_

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_theme.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"

namespace blink {

class DomicileThemeEventInit;

// The desktop's current theme.
//
// Pushed by the compositor. `setTheme()` is answered with this event, sent to
// every chrome on the desktop including the caller, since each monitor is a
// separate page.
//
// `prefers-color-scheme` does not reflect it: the theme comes from the
// compositor's `[theme] mode` config and `setTheme()` calls.
class MODULES_EXPORT DomicileThemeEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileThemeEvent* Create(const AtomicString& type,
                                    const DomicileThemeEventInit* initializer);

  DomicileThemeEvent(const AtomicString& type,
                     const DomicileThemeEventInit* initializer);
  DomicileThemeEvent(const AtomicString& type,
                     V8DomicileTheme theme,
                     DOMHighResTimeStamp arrival);
  ~DomicileThemeEvent() override;

  V8DomicileTheme theme() const { return theme_; }

  // When the browser process received this, on `performance.now()`'s clock.
  // See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  // Not nullable: the compositor sends the theme during the handshake.
  V8DomicileTheme theme_{V8DomicileTheme::Enum::kDark};
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_THEME_EVENT_H_
