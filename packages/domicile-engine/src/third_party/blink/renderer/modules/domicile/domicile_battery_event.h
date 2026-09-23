// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BATTERY_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BATTERY_EVENT_H_

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"

namespace blink {

class DomicileBatteryEventInit;

// The machine's battery: how full, and whether a lead is in.
//
// Pushed and never asked for, where DomicileFilesEvent is both: a charge is
// one reading rather than a list, so a page that has just loaded is caught up
// by the next push and there is no member on DomicileHost to answer. The
// compositor polls the kernel's own files and
// sends this when the reading moves far enough to draw -- see
// `domicile_host::battery` on that side.
//
// A page cannot read this for itself. navigator.getBattery() is the obvious
// route and is a trap here: it answers through UPower over D-Bus, a desktop
// on a bare tty has neither, and what comes back is Chromium's default
// BatteryStatus -- charging, and full. That default is a valid-looking reading,
// so no page can tell it from the truth, and a shell that trusted it drew
// `100%` on a machine running flat.
class MODULES_EXPORT DomicileBatteryEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileBatteryEvent* Create(
      const AtomicString& type,
      const DomicileBatteryEventInit* initializer);

  DomicileBatteryEvent(const AtomicString& type,
                       const DomicileBatteryEventInit* initializer);
  DomicileBatteryEvent(const AtomicString& type,
                       double charge,
                       bool charging,
                       DOMHighResTimeStamp arrival);
  ~DomicileBatteryEvent() override;

  double charge() const { return charge_; }
  bool charging() const { return charging_; }

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

 private:
  // Plain numbers rather than anything nullable: a machine with no battery
  // sends no message at all, so there is no absent reading for this event to
  // represent. An empty battery is 0.0, and is a reading.
  double charge_ = 0;
  bool charging_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BATTERY_EVENT_H_
