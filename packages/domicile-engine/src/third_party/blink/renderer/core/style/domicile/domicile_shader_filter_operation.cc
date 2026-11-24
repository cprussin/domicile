// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/style/domicile/domicile_shader_filter_operation.h"

#include "third_party/blink/renderer/platform/wtf/text/strcat.h"

namespace blink {

gfx::RectF DomicileShaderFilterOperation::MapRect(
    const gfx::RectF& rect) const {
  gfx::RectF mapped = rect;
  mapped.Outset(outset_);
  return mapped;
}

String DomicileShaderFilterOperation::DebugString() const {
  return StrCat({"<domicile-shader ", name_, ">"});
}

bool DomicileShaderFilterOperation::IsEqualAssumingSameType(
    const FilterOperation& o) const {
  const auto& other = static_cast<const DomicileShaderFilterOperation&>(o);
  return name_ == other.name_ && effect_ == other.effect_ &&
         outset_ == other.outset_ && arguments_ == other.arguments_;
}

}  // namespace blink
