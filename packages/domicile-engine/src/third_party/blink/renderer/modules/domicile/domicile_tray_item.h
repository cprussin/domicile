// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_TRAY_ITEM_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_TRAY_ITEM_H_

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// One icon in the system tray, as the compositor described it.
//
// A ScriptWrappable rather than a dictionary, for DomicileClipboardEntry's
// reason: these are read off DomicileHost.tray. Immutable, because
// the compositor sends the whole tray whenever any of it changes.
class MODULES_EXPORT DomicileTrayItem final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileTrayItem(const String& id,
                   const String& title,
                   const String& icon,
                   const String& bus,
                   const String& menu);
  ~DomicileTrayItem() override;

  const String& id() const { return id_; }
  const String& title() const { return title_; }
  const String& icon() const { return icon_; }
  const String& bus() const { return bus_; }
  const String& menu() const { return menu_; }

  void Trace(Visitor*) const override;

 private:
  // What DomicileHost::activateTrayItem names this icon by.
  String id_;
  String title_;
  // A `data:` URL, or empty for an icon the compositor could not draw.
  String icon_;
  // The bus name the item answers on.
  String bus_;
  // Its dbusmenu's object path on `bus_`, or empty for none.
  String menu_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_TRAY_ITEM_H_
