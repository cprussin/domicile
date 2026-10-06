// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CLIPBOARD_ENTRY_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CLIPBOARD_ENTRY_H_

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// One clipboard history entry, as the compositor described it.
//
// A ScriptWrappable because WebIDL does not allow a dictionary as an
// attribute's array element type.
//
// Immutable: the compositor resends the whole history on any change, because
// a copy can reorder the list and a page applying deltas could lose the order.
class MODULES_EXPORT DomicileClipboardEntry final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileClipboardEntry(uint32_t id, const String& preview);
  ~DomicileClipboardEntry() override;

  uint32_t id() const { return id_; }
  const String& preview() const { return preview_; }

  void Trace(Visitor*) const override;

 private:
  // The id DomicileHost::copyClipboardEntry takes. Never reused.
  uint32_t id_ = 0;
  // A preview for display, possibly truncated. Copying the entry back restores
  // the full content.
  String preview_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CLIPBOARD_ENTRY_H_
