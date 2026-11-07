// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_DOMICILE_PINCH_METADATA_H_
#define UI_EVENTS_DOMICILE_PINCH_METADATA_H_

#include <optional>

#include "base/check_op.h"
#include "base/containers/span.h"
#include "ui/events/event.h"
#include "ui/events/types/native_pinch.h"

namespace ui {

inline constexpr char kNativePinchMetadata[] = "domicile-pinch-metadata";

inline void SetPinchMetadata(Event &event, const NativePinch &pinch) {
  Event::Properties properties =
      event.properties() ? *event.properties() : Event::Properties();
  auto &bytes = properties[kNativePinchMetadata];
  bytes.resize(sizeof(pinch));
  base::span(bytes).copy_from(
      base::byte_span_from_ref(base::allow_nonunique_obj, pinch));
  event.SetProperties(properties);
}

inline std::optional<NativePinch> GetPinchMetadata(const Event &event) {
  if (!event.properties()) {
    return std::nullopt;
  }
  const auto found = event.properties()->find(kNativePinchMetadata);
  if (found == event.properties()->end()) {
    return std::nullopt;
  }
  NativePinch pinch;
  CHECK_EQ(found->second.size(), sizeof(pinch));
  base::byte_span_from_ref(base::allow_nonunique_obj, pinch)
      .copy_from(base::span(found->second));
  return pinch;
}

} // namespace ui

#endif // UI_EVENTS_DOMICILE_PINCH_METADATA_H_
