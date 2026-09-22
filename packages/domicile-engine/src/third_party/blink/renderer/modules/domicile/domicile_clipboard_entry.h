// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CLIPBOARD_ENTRY_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CLIPBOARD_ENTRY_H_

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// One thing that was copied, as the compositor described it.
//
// A ScriptWrappable rather than a dictionary, for DomicileDisplay's reason:
// WebIDL will not have a dictionary as the element type of an attribute's
// array, and these are read off a DomicileClipboardEvent.
//
// Immutable, and cheap to replace: the compositor sends the whole history
// whenever any of it changes, because a copy re-orders the list as often as it
// adds to it and a page reconciling deltas could be wrong about the order
// forever after missing one.
class MODULES_EXPORT DomicileClipboardEntry final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileClipboardEntry(uint32_t id, const String& preview);
  ~DomicileClipboardEntry() override;

  uint32_t id() const { return id_; }
  const String& preview() const { return preview_; }

  void Trace(Visitor*) const override;

 private:
  // What DomicileHost::copyClipboardEntry names this row by. Never reused, so
  // an id a page is holding either names the row it was told about or names
  // nothing at all.
  uint32_t id_ = 0;
  // Enough of what was copied to recognize it by, and not necessarily all of
  // it: the compositor cuts a long copy down to a row. What goes back on the
  // clipboard is always the whole thing.
  String preview_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CLIPBOARD_ENTRY_H_
