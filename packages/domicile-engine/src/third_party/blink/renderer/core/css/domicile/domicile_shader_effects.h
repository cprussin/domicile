// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_CSS_DOMICILE_DOMICILE_SHADER_EFFECTS_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_CSS_DOMICILE_DOMICILE_SHADER_EFFECTS_H_

#include <cstdint>
#include <optional>

#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/style/domicile/domicile_shader_filter_operation.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/supplementable.h"
#include "third_party/blink/renderer/platform/wtf/hash_map.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string_hash.h"

namespace blink {

class CSSFunctionValue;
class CSSToLengthConversionData;

// The shader effects the shell registered, by the name `domicile-shader()`
// gives them. See docs/architecture/MOTION.md#shader-primitive.
class CORE_EXPORT DomicileShaderEffects final
    : public GarbageCollected<DomicileShaderEffects>,
      public Supplement<Document> {
 public:
  static const char kSupplementName[];

  struct Effect {
    // Viz's id for it.
    uint32_t id = 0;
    // How far it may draw outside its box, in CSS pixels.
    float outset = 0;
    // How many floats it takes after `size`.
    uint32_t arguments = 0;
  };

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

  void Trace(Visitor*) const override;

 private:
  void Restyle();

  HashMap<AtomicString, Effect> effects_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_CSS_DOMICILE_DOMICILE_SHADER_EFFECTS_H_
