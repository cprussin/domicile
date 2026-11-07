// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#include "ui/events/domicile/pinch_metadata.h"

#include <limits>
#include <memory>
#include <vector>

#include "base/functional/bind.h"
#include "components/input/touchpad_pinch_event_queue.h"
#include "mojo/public/cpp/test_support/test_utils.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/blink/public/common/input/web_coalesced_input_event.h"
#include "third_party/blink/public/common/input/web_coalesced_input_event_mojom_traits.h"
#include "third_party/blink/public/common/input/web_gesture_event.h"
#include "third_party/blink/public/common/input/web_mouse_wheel_event.h"
#include "third_party/blink/public/mojom/input/input_handler.mojom.h"
#include "ui/events/blink/web_input_event.h"
#include "ui/events/gesture_event_details.h"

namespace domicile {
namespace {

class PinchAckClient : public input::TouchpadPinchEventQueueClient {
 public:
  void SendMouseWheelEventForPinchImmediately(
      const blink::WebGestureEvent& pinch,
      const input::MouseWheelEventWithLatencyInfo& wheel,
      MouseWheelEventHandledCallback callback,
      input::DispatchToRendererCallback& dispatch_callback) override {
    std::move(dispatch_callback)
        .Run(pinch, input::DispatchToRendererResult::kNotDispatched);
    std::move(callback).Run(
        wheel, blink::mojom::InputEventResultSource::kMainThread, next_ack);
  }

  void OnGestureEventForPinchAck(
      const input::GestureEventWithLatencyInfo& event,
      blink::mojom::InputEventResultSource source,
      blink::mojom::InputEventResultState result) override {
    results.push_back(result);
  }

  blink::mojom::InputEventResultState next_ack;
  std::vector<blink::mojom::InputEventResultState> results;
};

TEST(PinchMetadataTest, NativeClaimSurvivesTargetRemovalUntilSequenceEnds) {
  using Type = blink::WebInputEvent::Type;
  using State = blink::mojom::InputEventResultState;
  PinchAckClient client;
  input::TouchpadPinchEventQueue queue(&client);
  const auto deliver = [&](Type type, ui::NativePinchPhase phase, State ack) {
    blink::WebGestureEvent event(type, 0, base::TimeTicks(),
                                 blink::WebGestureDevice::kTouchpad);
    event.has_native_pinch = true;
    event.native_pinch = {phase, 7, 123, 2, 0, 0, 1.2, 0, false};
    if (type == Type::kGesturePinchUpdate) {
      event.data.pinch_update.scale = 1.2f;
    }
    client.next_ack = ack;
    input::DispatchToRendererCallback dispatch = base::BindOnce(
        [](const blink::WebInputEvent&, input::DispatchToRendererResult) {});
    queue.QueueEvent(input::GestureEventWithLatencyInfo(event), dispatch);
  };

  deliver(Type::kGesturePinchBegin, ui::NativePinchPhase::kBegin,
          State::kConsumed);
  deliver(Type::kGesturePinchUpdate, ui::NativePinchPhase::kUpdate,
          State::kNoConsumerExists);
  deliver(Type::kGesturePinchEnd, ui::NativePinchPhase::kEnd,
          State::kNoConsumerExists);
  deliver(Type::kGesturePinchBegin, ui::NativePinchPhase::kBegin,
          State::kNoConsumerExists);
  deliver(Type::kGesturePinchEnd, ui::NativePinchPhase::kEnd,
          State::kNoConsumerExists);
  EXPECT_EQ(
      client.results,
      (std::vector<State>{State::kConsumed, State::kConsumed, State::kConsumed,
                          State::kNoConsumerExists, State::kNoConsumerExists}));
}

TEST(PinchMetadataTest, NativeScaleAndRotationSurviveAuraAndGestureMojo) {
  ui::GestureEventDetails details(ui::EventType::kGesturePinchUpdate);
  details.set_device_type(ui::GestureDeviceType::DEVICE_TOUCHPAD);
  details.set_scale(1.2);
  ui::GestureEvent event(20, 30, 0, base::TimeTicks(), details);
  ui::NativePinch pinch{ui::NativePinchPhase::kUpdate,
                        7,
                        3000000000u,
                        0,
                        1.25,
                        -2.5,
                        1.6,
                        -12,
                        false};
  ui::SetPinchMetadata(event, pinch);
  const ui::GestureEvent copied(event);
  const auto web = ui::MakeWebGestureEvent(copied);
  EXPECT_FLOAT_EQ(web.data.pinch_update.scale, 1.2);
  ASSERT_TRUE(web.has_native_pinch);
  EXPECT_DOUBLE_EQ(web.native_pinch.scale, 1.6);
  EXPECT_DOUBLE_EQ(web.native_pinch.rotation, -12);
  auto original =
      std::make_unique<blink::WebCoalescedInputEvent>(web, ui::LatencyInfo());
  std::unique_ptr<blink::WebCoalescedInputEvent> received;
  ASSERT_TRUE(mojo::test::SerializeAndDeserialize<blink::mojom::Event>(
      original, received));
  const auto& gesture =
      static_cast<const blink::WebGestureEvent&>(received->Event());
  ASSERT_TRUE(gesture.has_native_pinch);
  EXPECT_EQ(gesture.native_pinch.device, 7u);
  EXPECT_EQ(gesture.native_pinch.time, 3000000000u);
  EXPECT_DOUBLE_EQ(gesture.native_pinch.dx, 1.25);
  EXPECT_DOUBLE_EQ(gesture.native_pinch.dy, -2.5);
  EXPECT_DOUBLE_EQ(gesture.native_pinch.scale, 1.6);
  EXPECT_DOUBLE_EQ(gesture.native_pinch.rotation, -12);
}

TEST(PinchMetadataTest, WheelMojoKeepsCancellationAndDoesNotMergeNativePhases) {
  blink::WebMouseWheelEvent wheel(blink::WebInputEvent::Type::kMouseWheel, 0,
                                  base::TimeTicks());
  wheel.has_native_pinch = true;
  wheel.native_pinch = {
      ui::NativePinchPhase::kEnd, 7, 3000000000u, 0, 0, 0, 1, 0, true};
  EXPECT_FALSE(wheel.CanCoalesce(wheel));
  auto original =
      std::make_unique<blink::WebCoalescedInputEvent>(wheel, ui::LatencyInfo());
  std::unique_ptr<blink::WebCoalescedInputEvent> copied;
  ASSERT_TRUE(mojo::test::SerializeAndDeserialize<blink::mojom::Event>(original,
                                                                       copied));
  const auto& received =
      static_cast<const blink::WebMouseWheelEvent&>(copied->Event());
  ASSERT_TRUE(received.has_native_pinch);
  EXPECT_EQ(received.native_pinch.phase, ui::NativePinchPhase::kEnd);
  EXPECT_EQ(received.native_pinch.time, 3000000000u);
  EXPECT_TRUE(received.native_pinch.canceled);
  wheel.native_pinch.scale = std::numeric_limits<double>::infinity();
  original =
      std::make_unique<blink::WebCoalescedInputEvent>(wheel, ui::LatencyInfo());
  copied.reset();
  EXPECT_FALSE(mojo::test::SerializeAndDeserialize<blink::mojom::Event>(
      original, copied));
}

}  // namespace
}  // namespace domicile
