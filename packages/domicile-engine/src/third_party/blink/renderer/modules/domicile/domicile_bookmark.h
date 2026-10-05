// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BOOKMARK_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BOOKMARK_H_

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// A URL the desk offers by name, as the compositor described it.
//
// A ScriptWrappable rather than a dictionary, for DomicileDesktopEntry's
// reason: these are read off a DomicileAppSearch.
class MODULES_EXPORT DomicileBookmark final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileBookmark(const String& name, const String& url, const String& icon);
  ~DomicileBookmark() override;

  const String& name() const { return name_; }
  const String& url() const { return url_; }
  const String& icon() const { return icon_; }

 private:
  String name_;
  String url_;
  // A `data:` URL, or empty for a site whose icon was not found.
  String icon_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BOOKMARK_H_
