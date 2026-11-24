// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_STYLE_DOMICILE_DOMICILE_SHADER_FILTER_OPERATION_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_STYLE_DOMICILE_DOMICILE_SHADER_FILTER_OPERATION_H_

#include <cstdint>

#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/style/filter_operation.h"
#include "third_party/blink/renderer/platform/wtf/casting.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"
#include "ui/gfx/geometry/rect_f.h"

namespace blink {

// A shell's shader effect, `domicile-shader(name, …)` in `filter` or
// `backdrop-filter`. Viz runs it; see
// //components/viz/service/display/domicile/shader_effects.h.
class CORE_EXPORT DomicileShaderFilterOperation final : public FilterOperation {
 public:
  // The most numbers the function takes after the name.
  static constexpr wtf_size_t kMaxArguments = 16;

  // `effect` is viz's id for the effect the shell registered as `name`, or 0
  // when it has registered none, which draws nothing. `outset` is in zoomed
  // CSS pixels. `arguments` has as many floats as the effect takes.
  DomicileShaderFilterOperation(const AtomicString& name,
                                uint32_t effect,
                                float outset,
                                Vector<float> arguments)
      : FilterOperation(OperationType::kDomicileShader),
        name_(name),
        effect_(effect),
        outset_(outset),
        arguments_(std::move(arguments)) {}

  const AtomicString& Name() const { return name_; }
  uint32_t Effect() const { return effect_; }
  float Outset() const { return outset_; }
  const Vector<float>& Arguments() const { return arguments_; }

  // Only one that draws outside its box moves pixels. One that does not
  // animates on the compositor thread, which refuses pixel-moving filters.
  bool MovesPixels() const override { return outset_ > 0; }
  gfx::RectF MapRect(const gfx::RectF& rect) const override;

  String DebugString() const override;

 protected:
  bool IsEqualAssumingSameType(const FilterOperation& o) const override;

 private:
  AtomicString name_;
  uint32_t effect_;
  float outset_;
  Vector<float> arguments_;
};

template <>
struct DowncastTraits<DomicileShaderFilterOperation> {
  static bool AllowFrom(const FilterOperation& op) {
    return op.GetType() == FilterOperation::OperationType::kDomicileShader;
  }
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_STYLE_DOMICILE_DOMICILE_SHADER_FILTER_OPERATION_H_
