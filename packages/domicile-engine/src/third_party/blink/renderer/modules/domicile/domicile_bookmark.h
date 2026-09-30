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
// reason: these are read off a DomicileAppsEvent's array attribute.
class MODULES_EXPORT DomicileBookmark final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileBookmark(const String& name, const String& url, const String& label);
  ~DomicileBookmark() override;

  const String& name() const { return name_; }
  const String& url() const { return url_; }
  const String& label() const { return label_; }

 private:
  String name_;
  String url_;
  // Empty when the desk did not say which of the bookmark's URLs this is.
  String label_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BOOKMARK_H_
