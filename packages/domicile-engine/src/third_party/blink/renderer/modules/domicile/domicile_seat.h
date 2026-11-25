// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SEAT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SEAT_H_

#include <optional>

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/bindings/core/v8/idl_types.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/heap/member.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace blink {

// An agent's seat, as the compositor described it.
//
// Immutable, and replaced whole: the compositor sends every seat whenever any
// of them changes, as it does the clipboard's history.
class MODULES_EXPORT DomicileSeat final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileSeat(const String& id,
               const String& name,
               std::optional<double> pointer_x,
               std::optional<double> pointer_y,
               const String& focused,
               const Vector<String>& holds,
               const Vector<String>& taken);
  ~DomicileSeat() override;

  const String& id() const { return id_; }
  const String& name() const { return name_; }
  std::optional<double> pointerX() const { return pointer_x_; }
  std::optional<double> pointerY() const { return pointer_y_; }
  const String& focused() const { return focused_; }
  const FrozenArray<IDLString>& holds() const { return *holds_; }
  const FrozenArray<IDLString>& taken() const { return *taken_; }

  void Trace(Visitor*) const override;

 private:
  String id_;
  String name_;
  // Both or neither: absent before the agent first points.
  std::optional<double> pointer_x_;
  std::optional<double> pointer_y_;
  // Null for none.
  String focused_;
  Member<FrozenArray<IDLString>> holds_;
  Member<FrozenArray<IDLString>> taken_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SEAT_H_
