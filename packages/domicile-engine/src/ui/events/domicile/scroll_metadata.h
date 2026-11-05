// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_DOMICILE_SCROLL_METADATA_H_
#define UI_EVENTS_DOMICILE_SCROLL_METADATA_H_

#include <array>
#include <optional>

#include "base/check_op.h"
#include "base/containers/span.h"
#include "ui/events/event.h"
#include "ui/events/types/native_scroll_source.h"

namespace ui {

struct NativeScrollMetadata {
  NativeScrollSource source;
  bool stop_x;
  bool stop_y;
  std::optional<std::array<double, 2>> axis_distance;
};

inline constexpr char kNativeScrollMetadata[] = "domicile-scroll-metadata";
inline constexpr char kNativeScrollDistance[] = "domicile-scroll-distance";

// Event properties survive aura's copies without changing browser scrolling.
inline void SetScrollMetadata(
    Event& event,
    NativeScrollSource source,
    bool stop_x,
    bool stop_y,
    std::optional<std::array<double, 2>> axis_distance = std::nullopt) {
  Event::Properties properties =
      event.properties() ? *event.properties() : Event::Properties();
  properties[kNativeScrollMetadata] = {static_cast<uint8_t>(source),
                                       static_cast<uint8_t>(stop_x),
                                       static_cast<uint8_t>(stop_y)};
  if (axis_distance) {
    auto& bytes = properties[kNativeScrollDistance];
    bytes.resize(sizeof(*axis_distance));
    base::span(bytes).copy_from(
        base::as_byte_span(base::allow_nonunique_obj, *axis_distance));
  } else {
    properties.erase(kNativeScrollDistance);
  }
  event.SetProperties(properties);
}

inline NativeScrollMetadata GetScrollMetadata(const Event& event,
                                              NativeScrollSource source) {
  if (event.properties()) {
    const auto found = event.properties()->find(kNativeScrollMetadata);
    if (found != event.properties()->end()) {
      const auto& values = found->second;
      CHECK_EQ(values.size(), 3u);
      CHECK_LE(values[0], static_cast<uint8_t>(NativeScrollSource::kWheelTilt));
      std::optional<std::array<double, 2>> axis_distance;
      const auto distance = event.properties()->find(kNativeScrollDistance);
      if (distance != event.properties()->end()) {
        axis_distance.emplace();
        CHECK_EQ(distance->second.size(), sizeof(*axis_distance));
        base::as_writable_byte_span(base::allow_nonunique_obj, *axis_distance)
            .copy_from(base::span(distance->second));
      }
      return {static_cast<NativeScrollSource>(values[0]), values[1] != 0,
              values[2] != 0, axis_distance};
    }
  }
  return {source, false, false, std::nullopt};
}

}  // namespace ui

#endif  // UI_EVENTS_DOMICILE_SCROLL_METADATA_H_
