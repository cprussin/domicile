// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_CSS_DOMICILE_DOMICILE_SHADER_EFFECTS_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_CSS_DOMICILE_DOMICILE_SHADER_EFFECTS_H_

#include <cstdint>
#include <optional>
#include <utility>

#include "base/containers/span.h"
#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/style/domicile/domicile_shader_filter_operation.h"
#include "third_party/blink/renderer/platform/heap/collection_support/heap_hash_map.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/heap/member.h"
#include "third_party/blink/renderer/platform/supplementable.h"
#include "third_party/blink/renderer/platform/wtf/hash_map.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string_hash.h"

namespace blink {

class CompositorFilterOperations;
class CSSFunctionValue;
class CSSToLengthConversionData;
class Element;
class Node;

// The shader effects the shell registered, by the name `domicile-shader()`
// gives them. See docs/architecture/MOTION.md#shader-primitive.
class CORE_EXPORT DomicileShaderEffects final
    : public GarbageCollected<DomicileShaderEffects>,
      public Supplement<Document> {
 public:
  static const char kSupplementName[];

  // An array uniform, and how many floats it holds.
  struct Array {
    String name;
    uint32_t floats = 0;
  };

  struct Effect {
    // Viz's id for it.
    uint32_t id = 0;
    // How far it may draw outside its box, in CSS pixels.
    float outset = 0;
    // Whether it may draw as far as the screen's longer side instead.
    bool screen_outset = false;
    // How many floats it takes after `size`.
    uint32_t arguments = 0;
    // Its array uniforms, in the order it declares them.
    Vector<Array> arrays;
  };

  // The most floats an element's arrays hold, across its effects: 64 KiB.
  static constexpr uint32_t kMaxArrayFloats = 16 * 1024;

  static DomicileShaderEffects& From(Document&);

  explicit DomicileShaderEffects(Document&);

  // The operation for `domicile-shader(name, …)`. An effect the shell has not
  // registered is kept, by name, and draws nothing. Arguments past what the
  // effect takes are dropped, and missing ones are zero.
  static DomicileShaderFilterOperation* Resolve(
      const CSSFunctionValue& function,
      const Document& document,
      const CSSToLengthConversionData& conversion_data);

  std::optional<Effect> Find(const AtomicString& name) const;

  // Names `effect` `name`, and returns the id of the effect it replaces, or
  // 0. Every element's style is resolved again.
  uint32_t Register(const AtomicString& name, const Effect& effect);

  // Forgets effect `id`, and returns its name, or a null string if no name
  // has it.
  AtomicString Drop(uint32_t id);

  // Why SetArray() could not: an unknown effect or array (`not_found`), or
  // too many values for the array or for the element.
  struct ArrayError {
    bool not_found = false;
    String message;
  };

  // Sets array `uniform` of effect `name` for `element` to `values`, and the
  // rest of that array to zero. The element draws them in its next frame.
  std::optional<ArrayError> SetArray(Element& element,
                                     const AtomicString& name,
                                     const String& uniform,
                                     base::span<const float> values);

  // Gives each shader effect in `operations`, a filter of `node`, the arrays
  // the page set for `node`.
  static void AttachArrays(const Node* node,
                           CompositorFilterOperations& operations);

  void Trace(Visitor*) const override;

 private:
  // An element's arrays, by effect id, each its effect's arrays end to end.
  class ElementArrays final : public GarbageCollected<ElementArrays> {
   public:
    Vector<std::pair<uint32_t, Vector<float>>> by_effect;
    void Trace(Visitor*) const {}
  };

  void Restyle();
  // Forgets every element's arrays of effect `id`.
  void DropArrays(uint32_t id);

  HashMap<AtomicString, Effect> effects_;
  HeapHashMap<WeakMember<Element>, Member<ElementArrays>> arrays_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_CSS_DOMICILE_DOMICILE_SHADER_EFFECTS_H_
