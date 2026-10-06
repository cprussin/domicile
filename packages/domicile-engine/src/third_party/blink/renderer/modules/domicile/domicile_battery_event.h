// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BATTERY_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BATTERY_EVENT_H_

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"

namespace blink {

class DomicileBatteryEventInit;

// The machine's battery: charge level and whether AC power is connected.
//
// Push-only: a charge is one reading, so the next push catches up a newly
// loaded page. The compositor polls sysfs and sends this when the reading
// changes enough to redraw; see `domicile_host::battery`.
//
// Pages must not use navigator.getBattery(): it reads UPower over D-Bus, which
// a bare tty lacks, and Chromium then reports its default of charging and
// full. That default looks real, so a shell would show 100% on a dying
// battery.
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

  // When the browser process received this, on `performance.now()`'s clock.
  // See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

 private:
  // Plain numbers, not nullable: a machine with no battery sends no event. An
  // empty battery is 0.0.
  double charge_ = 0;
  bool charging_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BATTERY_EVENT_H_
