// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#include "ui/events/domicile/scroll_metadata.h"

#include <limits>
#include <memory>

#include "mojo/public/cpp/test_support/test_utils.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/blink/public/common/input/web_coalesced_input_event.h"
#include "third_party/blink/public/common/input/web_coalesced_input_event_mojom_traits.h"
#include "third_party/blink/public/common/input/web_mouse_wheel_event.h"
#include "third_party/blink/public/mojom/input/input_handler.mojom.h"
#include "ui/events/blink/web_input_event.h"

namespace domicile {
namespace {

TEST(ScrollMetadataTest, DeviceSourceAndIndependentStopsSurviveEventCopies) {
  for (const auto source :
       {ui::NativeScrollSource::kFinger, ui::NativeScrollSource::kContinuous}) {
    ui::ScrollEvent scroll(ui::EventType::kScroll, gfx::PointF(), gfx::PointF(),
                           base::TimeTicks(), 0, 0, -2.5, 0, -2.5, 2);
    ui::SetScrollMetadata(scroll, source, true, false,
                          std::array<double, 2>{0, -7.5});
    const ui::ScrollEvent copied(scroll);
    const auto web = ui::MakeWebMouseWheelEvent(copied);
    EXPECT_EQ(web.native_scroll_source, source);
    EXPECT_TRUE(web.axis_stop_x);
    EXPECT_FALSE(web.axis_stop_y);
    EXPECT_TRUE(web.has_native_axis_distance);
    EXPECT_EQ(web.native_axis_distance_x, 0);
    EXPECT_EQ(web.native_axis_distance_y, -7.5);
    EXPECT_EQ(web.delta_x, 0);
    EXPECT_EQ(web.delta_y, -2.5);
    EXPECT_EQ(web.delta_units, ui::ScrollGranularity::kScrollByPrecisePixel);
    EXPECT_EQ(web.phase, blink::WebMouseWheelEvent::kPhaseNone);

    ui::ScrollEvent stopped(ui::EventType::kScroll, gfx::PointF(),
                            gfx::PointF(), base::TimeTicks(), 0, 0, 0, 0, 0, 2);
    ui::SetScrollMetadata(stopped, source, false, true,
                          std::array<double, 2>{0, 0});
    const auto terminal = ui::MakeWebMouseWheelEvent(stopped);
    EXPECT_EQ(terminal.phase, blink::WebMouseWheelEvent::kPhaseEnded);
    EXPECT_FALSE(terminal.axis_stop_x);
    EXPECT_TRUE(terminal.axis_stop_y);
    ui::SetScrollMetadata(stopped, source, true, false,
                          std::array<double, 2>{0, -0.25});
    EXPECT_EQ(ui::MakeWebMouseWheelEvent(stopped).phase,
              blink::WebMouseWheelEvent::kPhaseNone);
  }
}

TEST(ScrollMetadataTest, WheelDetentsAreIndependentOfPixelDistance) {
  ui::MouseWheelEvent wheel(gfx::Vector2d(120, -240), gfx::PointF(),
                            gfx::PointF(), base::TimeTicks(), 0, 0,
                            gfx::Vector2d(120, -120));
  EXPECT_FALSE(ui::MakeWebMouseWheelEvent(wheel).has_native_axis_distance);
  ui::SetScrollMetadata(wheel, ui::NativeScrollSource::kWheelTilt, false, false,
                        std::array<double, 2>{11.25, -7.5});
  const auto web = ui::MakeWebMouseWheelEvent(wheel);
  EXPECT_EQ(web.native_scroll_source, ui::NativeScrollSource::kWheelTilt);
  EXPECT_TRUE(web.has_native_axis_distance);
  EXPECT_EQ(web.native_axis_distance_x, 11.25);
  EXPECT_EQ(web.native_axis_distance_y, -7.5);
  EXPECT_EQ(web.delta_x, 120);
  EXPECT_EQ(web.wheel_ticks_x, 1);
  EXPECT_EQ(web.delta_y, -240);
  EXPECT_EQ(web.wheel_ticks_y, -1);
}

TEST(ScrollMetadataTest, StopsAndSourcesSeparateCoalescedFrames) {
  blink::WebMouseWheelEvent first(blink::WebInputEvent::Type::kMouseWheel, 0,
                                  base::TimeTicks());
  first.native_scroll_source = ui::NativeScrollSource::kFinger;
  auto next = first;
  EXPECT_TRUE(first.CanCoalesce(next));
  next.has_native_axis_distance = true;
  EXPECT_FALSE(first.CanCoalesce(next));
  first = next;
  first.native_axis_distance_x = 7.5;
  first.native_axis_distance_y = -11.25;
  next.native_axis_distance_x = 3.25;
  next.native_axis_distance_y = -2.5;
  ASSERT_TRUE(first.CanCoalesce(next));
  first.Coalesce(next);
  EXPECT_EQ(first.native_axis_distance_x, 10.75);
  EXPECT_EQ(first.native_axis_distance_y, -13.75);
  next.native_scroll_source = ui::NativeScrollSource::kContinuous;
  EXPECT_FALSE(first.CanCoalesce(next));
  next = first;
  next.axis_stop_x = true;
  EXPECT_FALSE(first.CanCoalesce(next));
  EXPECT_FALSE(next.CanCoalesce(first));
  next.axis_stop_x = false;
  next.axis_stop_y = true;
  EXPECT_FALSE(first.CanCoalesce(next));
  EXPECT_FALSE(next.CanCoalesce(first));
}

TEST(ScrollMetadataTest, MetadataSurvivesRendererIpc) {
  blink::WebMouseWheelEvent wheel(blink::WebInputEvent::Type::kMouseWheel, 0,
                                  base::TimeTicks());
  wheel.native_scroll_source = ui::NativeScrollSource::kWheelTilt;
  wheel.has_native_axis_distance = true;
  wheel.native_axis_distance_x = 7.5;
  wheel.native_axis_distance_y = -11.25;
  wheel.axis_stop_y = true;
  wheel.delta_x = 2.5;
  auto original =
      std::make_unique<blink::WebCoalescedInputEvent>(wheel, ui::LatencyInfo());
  std::unique_ptr<blink::WebCoalescedInputEvent> copied;
  ASSERT_TRUE(mojo::test::SerializeAndDeserialize<blink::mojom::Event>(original,
                                                                       copied));
  const auto& received =
      static_cast<const blink::WebMouseWheelEvent&>(copied->Event());
  EXPECT_EQ(received.native_scroll_source, ui::NativeScrollSource::kWheelTilt);
  EXPECT_TRUE(received.has_native_axis_distance);
  EXPECT_EQ(received.native_axis_distance_x, 7.5);
  EXPECT_EQ(received.native_axis_distance_y, -11.25);
  EXPECT_EQ(received.delta_x, 2.5);
  EXPECT_FALSE(received.axis_stop_x);
  EXPECT_TRUE(received.axis_stop_y);

  wheel.native_axis_distance_x = std::numeric_limits<double>::infinity();
  original =
      std::make_unique<blink::WebCoalescedInputEvent>(wheel, ui::LatencyInfo());
  copied.reset();
  EXPECT_FALSE(mojo::test::SerializeAndDeserialize<blink::mojom::Event>(
      original, copied));
  wheel.native_axis_distance_x = 7.5;
  wheel.native_scroll_source = static_cast<ui::NativeScrollSource>(255);
  original =
      std::make_unique<blink::WebCoalescedInputEvent>(wheel, ui::LatencyInfo());
  copied.reset();
  EXPECT_FALSE(mojo::test::SerializeAndDeserialize<blink::mojom::Event>(
      original, copied));
}

}  // namespace
}  // namespace domicile
