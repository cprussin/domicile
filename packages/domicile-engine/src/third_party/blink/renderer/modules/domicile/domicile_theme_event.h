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

// Which way round the desktop is drawn now.
//
// Pushed, like DomicileBatteryEvent, and the one pushed event a page can
// cause: `setTheme()` on the other direction is answered with this, to every
// chrome on the desk rather than to the one that called. A desk of three
// monitors is three pages and the toggle is on one of them, so the page that
// asked is told along with the rest instead of believing its own click.
//
// A PAGE CANNOT READ THIS FOR ITSELF, and `prefers-color-scheme` is the route
// that looks like it can. That media query answers out of this engine's own
// notion of a system preference, which under Domicile is nothing -- there is
// no desktop above this one to have a preference. The theme is the
// compositor's, out of `[theme] mode` in its config and whatever the toggle
// has done to it since, and this is how it arrives.
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

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  // Not nullable and with no member for absence: the compositor tells a chrome
  // the theme as part of the handshake, so an event carrying "no theme" is a
  // state this channel does not have.
  V8DomicileTheme theme_{V8DomicileTheme::Enum::kDark};
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_THEME_EVENT_H_
