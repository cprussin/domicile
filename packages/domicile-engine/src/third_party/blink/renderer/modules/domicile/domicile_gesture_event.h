// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_GESTURE_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_GESTURE_EVENT_H_

#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

class DomicileGestureEventInit;

// A phase of a gesture the page grabbed. See
// DomicileHost::grabGesture.
class MODULES_EXPORT DomicileGestureEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileGestureEvent* Create(
      const AtomicString& type,
      const DomicileGestureEventInit* initializer);

  DomicileGestureEvent(const AtomicString& type,
                       const DomicileGestureEventInit* initializer);
  DomicileGestureEvent(const AtomicString& type,
                       const String& kind,
                       const String& phase,
                       uint32_t fingers,
                       double dx,
                       double dy,
                       double scale,
                       double rotation,
                       bool canceled,
                       const String& edge);
  ~DomicileGestureEvent() override;

  const String& kind() const { return kind_; }
  const String& phase() const { return phase_; }
  uint32_t fingers() const { return fingers_; }
  double dx() const { return dx_; }
  double dy() const { return dy_; }
  double scale() const { return scale_; }
  double rotation() const { return rotation_; }
  bool canceled() const { return canceled_; }
  const String& edge() const { return edge_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  String kind_;
  String phase_;
  uint32_t fingers_ = 0;
  double dx_ = 0;
  double dy_ = 0;
  double scale_ = 1;
  double rotation_ = 0;
  bool canceled_ = false;
  String edge_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_GESTURE_EVENT_H_
