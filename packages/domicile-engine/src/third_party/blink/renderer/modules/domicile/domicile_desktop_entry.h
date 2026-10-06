// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_DESKTOP_ENTRY_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_DESKTOP_ENTRY_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// An application a desktop entry offers, as the compositor described it.
//
// A ScriptWrappable rather than a dictionary, for DomicileClipboardEntry's
// reason: WebIDL will not have a dictionary as the element type of an
// attribute's array, and these are read off a DomicileAppSearch.
class MODULES_EXPORT DomicileDesktopEntry final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileDesktopEntry(const String& id,
                       const String& name,
                       const String& comment,
                       Vector<String> command,
                       const String& icon,
                       const String& preview);
  ~DomicileDesktopEntry() override;

  const String& id() const { return id_; }
  const String& name() const { return name_; }
  const String& comment() const { return comment_; }
  const FrozenArray<IDLString>& command() const { return *command_; }
  const String& icon() const { return icon_; }
  const String& preview() const { return preview_; }

  void Trace(Visitor*) const override;

 private:
  String id_;
  String name_;
  // Empty for an entry that has none.
  String comment_;
  // The argv, never empty: the browser drops an entry with no command before
  // it gets here.
  Member<FrozenArray<IDLString>> command_;
  // A `data:` URL, or empty for an entry whose icon was not found.
  String icon_;
  // The same, for the picture the entry names for a launcher's preview.
  String preview_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_DESKTOP_ENTRY_H_
