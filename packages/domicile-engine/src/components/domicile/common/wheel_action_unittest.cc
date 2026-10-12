// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

// Patch 0112 edits Chromium's own classification of a wheel tick. Its test
// lives here because domicile_unittests is the suite CI runs.

#include "base/time/time.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "third_party/blink/public/common/input/web_mouse_wheel_event.h"
#include "ui/events/types/scroll_types.h"

namespace domicile {
namespace {

using Action = blink::WebMouseWheelEvent::EventAction;

// One detent of a mouse wheel, down, with `modifiers` held.
blink::WebMouseWheelEvent Detent(int modifiers) {
  blink::WebMouseWheelEvent event(blink::WebInputEvent::Type::kMouseWheel,
                                  modifiers, base::TimeTicks::Now());
  event.delta_units = ui::ScrollGranularity::kScrollByPixel;
  event.delta_y = -120;
  event.wheel_ticks_y = -1;
  return event;
}

TEST(WheelActionTest, CtrlWheelScrolls) {
  // Chrome makes this kPageZoom, which scrolls nothing.
  EXPECT_EQ(blink::WebMouseWheelEvent::GetPlatformSpecificDefaultEventAction(
                Detent(blink::WebInputEvent::kControlKey)),
            Action::kScrollVertical);
}

}  // namespace
}  // namespace domicile
