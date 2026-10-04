// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BROWSER_WINDOW_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BROWSER_WINDOW_H_

#include <cstdint>
#include <optional>

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// One of the desk's browser windows, as the browser listed it.
//
// Immutable, like DomicileDisplay: the browser resends the whole list on every
// change, so each window is replaced, never edited.
class MODULES_EXPORT DomicileBrowserWindow final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileBrowserWindow(const String& id,
                        const String& url,
                        const String& title,
                        std::optional<int32_t> popup_window,
                        int32_t width,
                        int32_t height);
  ~DomicileBrowserWindow() override;

  const String& id() const { return id_; }
  const String& url() const { return url_; }
  const String& title() const { return title_; }
  std::optional<int32_t> popupWindow() const { return popup_window_; }
  int32_t width() const { return width_; }
  int32_t height() const { return height_; }

  void Trace(Visitor*) const override;

 private:
  String id_;
  String url_;
  String title_;
  std::optional<int32_t> popup_window_;
  int32_t width_ = 0;
  int32_t height_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_BROWSER_WINDOW_H_
