// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_TOUCH_EDGE_SWIPES_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_TOUCH_EDGE_SWIPES_H_

#include <memory>
#include <vector>

#include "base/component_export.h"
#include "base/containers/flat_map.h"
#include "base/functional/callback.h"
#include "base/timer/timer.h"
#include "ui/events/domicile/edge_swipe.h"
#include "ui/events/ozone/evdev/device_event_dispatcher_evdev.h"

namespace ui {

// Each touchscreen's `EdgeSwipe`, and the touches it withholds.
//
// On the UI thread, where `EventFactoryEvdev` dispatches touches: a touch
// goes through here first, and on to `dispatch` now, later, or never. Only a
// touchscreen bound to a display has edges; the rest go straight through.
// See docs/architecture/GESTURES.md#edge-swipes in the Domicile repository.
class COMPONENT_EXPORT(EVDEV) TouchEdgeSwipes {
 public:
  using Dispatch = base::RepeatingCallback<void(const TouchEventParams&)>;

  explicit TouchEdgeSwipes(Dispatch dispatch);
  TouchEdgeSwipes(const TouchEdgeSwipes&) = delete;
  TouchEdgeSwipes& operator=(const TouchEdgeSwipes&) = delete;
  ~TouchEdgeSwipes();

  // A touch from the device, untransformed.
  void Touch(const TouchEventParams& params);

 private:
  struct Device {
    Device();
    ~Device();

    EdgeSwipe swipe;
    std::vector<TouchEventParams> withheld;
    base::OneShotTimer wait;
  };

  // The finger `device_id` withholds waited too long.
  void Expire(int device_id);

  // Dispatches what `device` withheld, in order.
  void Release(Device& device);

  const Dispatch dispatch_;
  base::flat_map<int, std::unique_ptr<Device>> devices_;
};

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_TOUCH_EDGE_SWIPES_H_
