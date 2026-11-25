// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/css/domicile/domicile_shader_effects.h"

#include <algorithm>

#include "third_party/blink/renderer/core/css/css_custom_ident_value.h"
#include "third_party/blink/renderer/core/css/css_function_value.h"
#include "third_party/blink/renderer/core/css/css_primitive_value.h"
#include "third_party/blink/renderer/core/css/css_to_length_conversion_data.h"
#include "third_party/blink/renderer/core/css/style_engine.h"
#include "third_party/blink/renderer/core/dom/element.h"
#include "third_party/blink/renderer/core/frame/local_frame_view.h"
#include "third_party/blink/renderer/core/layout/layout_box_model_object.h"
#include "third_party/blink/renderer/core/paint/paint_layer.h"
#include "third_party/blink/renderer/core/style/domicile/domicile_shader_filter_operation.h"
#include "third_party/blink/renderer/platform/graphics/compositor_filter_operations.h"

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
  // A screen outset is the viewport's longer side, already zoomed: the
  // shell's page is the screen.
  const float outset =
      effect->screen_outset
          ? static_cast<float>(std::max(conversion_data.ViewportWidth(),
                                        conversion_data.ViewportHeight()))
          : effect->outset * conversion_data.Zoom();
  return MakeGarbageCollected<DomicileShaderFilterOperation>(
      name, effect->id, outset, std::move(arguments));
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
  if (replaced) {
    DropArrays(replaced);
  }
  Restyle();
  return replaced;
}

AtomicString DomicileShaderEffects::Drop(uint32_t id) {
  for (const auto& entry : effects_) {
    if (entry.value.id == id) {
      const AtomicString dropped = entry.key;
      effects_.erase(dropped);
      DropArrays(id);
      Restyle();
      return dropped;
    }
  }
  return AtomicString();
}

std::optional<DomicileShaderEffects::ArrayError>
DomicileShaderEffects::SetArray(Element& element,
                                const AtomicString& name,
                                const String& uniform,
                                base::span<const float> values) {
  auto effect = effects_.find(name);
  if (effect == effects_.end()) {
    return ArrayError{.not_found = true,
                      .message = "no shader effect is named " + name};
  }
  uint32_t offset = 0;
  uint32_t total = 0;
  std::optional<Array> found;
  for (const Array& array : effect->value.arrays) {
    if (array.name == uniform) {
      found = array;
      offset = total;
    }
    total += array.floats;
  }
  if (!found) {
    return ArrayError{
        .not_found = true,
        .message = "shader effect " + name + " has no array named " + uniform};
  }
  if (values.size() > found->floats) {
    return ArrayError{.message = "array " + uniform + " holds " +
                                 String::Number(found->floats) +
                                 " floats, not " +
                                 String::Number(values.size())};
  }

  auto it = arrays_.find(&element);
  ElementArrays* arrays =
      it == arrays_.end()
          ? arrays_.Set(&element, MakeGarbageCollected<ElementArrays>())
                .stored_value->value.Get()
          : it->value.Get();
  Vector<float>* stored = nullptr;
  size_t held = 0;
  for (auto& entry : arrays->by_effect) {
    if (entry.first == effect->value.id) {
      stored = &entry.second;
    } else {
      held += entry.second.size();
    }
  }
  if (held + total > kMaxArrayFloats) {
    return ArrayError{.message = "an element's arrays hold at most " +
                                 String::Number(kMaxArrayFloats) + " floats"};
  }
  if (!stored) {
    arrays->by_effect.emplace_back(effect->value.id, Vector<float>(total, 0.f));
    stored = &arrays->by_effect.back().second;
  }
  for (uint32_t i = 0; i < found->floats; ++i) {
    (*stored)[offset + i] = i < values.size() ? values[i] : 0.f;
  }

  // The filters are built again in the next frame, with these arrays.
  if (auto* box = DynamicTo<LayoutBoxModelObject>(element.GetLayoutObject())) {
    if (PaintLayer* layer = box->Layer()) {
      layer->SetFilterOnEffectNodeDirty();
      layer->SetBackdropFilterOnEffectNodeDirty();
    }
    box->SetNeedsPaintPropertyUpdate();
  }
  if (LocalFrameView* view = element.GetDocument().View()) {
    view->ScheduleAnimation();
  }
  return std::nullopt;
}

// static
void DomicileShaderEffects::AttachArrays(
    const Node* node,
    CompositorFilterOperations& operations) {
  const auto* element = DynamicTo<Element>(node);
  if (!element) {
    return;
  }
  const DomicileShaderEffects* effects =
      Supplement<Document>::From<DomicileShaderEffects>(element->GetDocument());
  if (!effects) {
    return;
  }
  auto it = effects->arrays_.find(const_cast<Element*>(element));
  if (it == effects->arrays_.end()) {
    return;
  }
  for (const auto& entry : it->value->by_effect) {
    operations.SetDomicileShaderArrays(entry.first, entry.second);
  }
}

void DomicileShaderEffects::DropArrays(uint32_t id) {
  for (auto& entry : arrays_) {
    auto& by_effect = entry.value->by_effect;
    for (wtf_size_t i = by_effect.size(); i > 0; --i) {
      if (by_effect[i - 1].first == id) {
        by_effect.EraseAt(i - 1);
      }
    }
  }
}

void DomicileShaderEffects::Restyle() {
  // A filter names an effect by name, and resolves it to an id at style
  // time, as a registered custom property resolves.
  GetSupplementable()->GetStyleEngine().PropertyRegistryChanged();
}

void DomicileShaderEffects::Trace(Visitor* visitor) const {
  visitor->Trace(arrays_);
  Supplement<Document>::Trace(visitor);
}

}  // namespace blink
