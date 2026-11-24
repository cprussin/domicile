// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/css/domicile/domicile_shader_effects.h"

#include "third_party/blink/renderer/core/css/css_custom_ident_value.h"
#include "third_party/blink/renderer/core/css/css_function_value.h"
#include "third_party/blink/renderer/core/css/css_primitive_value.h"
#include "third_party/blink/renderer/core/css/css_to_length_conversion_data.h"
#include "third_party/blink/renderer/core/css/style_engine.h"
#include "third_party/blink/renderer/core/style/domicile/domicile_shader_filter_operation.h"

namespace blink {

// static
const char DomicileShaderEffects::kSupplementName[] = "DomicileShaderEffects";

// static
DomicileShaderEffects& DomicileShaderEffects::From(Document& document) {
  DomicileShaderEffects* effects =
      Supplement<Document>::From<DomicileShaderEffects>(document);
  if (!effects) {
    effects = MakeGarbageCollected<DomicileShaderEffects>(document);
    ProvideTo(document, effects);
  }
  return *effects;
}

DomicileShaderEffects::DomicileShaderEffects(Document& document)
    : Supplement<Document>(document) {}

// static
DomicileShaderFilterOperation* DomicileShaderEffects::Resolve(
    const CSSFunctionValue& function,
    const Document& document,
    const CSSToLengthConversionData& conversion_data) {
  const AtomicString& name = To<CSSCustomIdentValue>(function.Item(0)).Value();
  const DomicileShaderEffects* effects =
      Supplement<Document>::From<DomicileShaderEffects>(document);
  const std::optional<Effect> effect =
      effects ? effects->Find(name) : std::nullopt;
  if (!effect) {
    return MakeGarbageCollected<DomicileShaderFilterOperation>(name, 0, 0.f,
                                                               Vector<float>());
  }

  Vector<float> arguments(effect->arguments, 0.f);
  for (wtf_size_t i = 1; i < function.length() && i - 1 < effect->arguments;
       ++i) {
    arguments[i - 1] = static_cast<float>(
        To<CSSPrimitiveValue>(function.Item(i)).ComputeNumber(conversion_data));
  }
  return MakeGarbageCollected<DomicileShaderFilterOperation>(
      name, effect->id, effect->outset * conversion_data.Zoom(),
      std::move(arguments));
}

std::optional<DomicileShaderEffects::Effect> DomicileShaderEffects::Find(
    const AtomicString& name) const {
  auto it = effects_.find(name);
  if (it == effects_.end()) {
    return std::nullopt;
  }
  return it->value;
}

uint32_t DomicileShaderEffects::Register(const AtomicString& name,
                                         const Effect& effect) {
  auto it = effects_.find(name);
  const uint32_t replaced = it == effects_.end() ? 0 : it->value.id;
  effects_.Set(name, effect);
  Restyle();
  return replaced;
}

AtomicString DomicileShaderEffects::Drop(uint32_t id) {
  for (const auto& entry : effects_) {
    if (entry.value.id == id) {
      const AtomicString dropped = entry.key;
      effects_.erase(dropped);
      Restyle();
      return dropped;
    }
  }
  return AtomicString();
}

void DomicileShaderEffects::Restyle() {
  // A filter names an effect by name, and resolves it to an id at style
  // time, as a registered custom property resolves.
  GetSupplementable()->GetStyleEngine().PropertyRegistryChanged();
}

void DomicileShaderEffects::Trace(Visitor* visitor) const {
  Supplement<Document>::Trace(visitor);
}

}  // namespace blink
