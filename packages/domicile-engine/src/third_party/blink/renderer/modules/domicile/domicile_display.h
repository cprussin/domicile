// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_DISPLAY_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_DISPLAY_H_

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// One screen of the desktop, as the compositor described it.
//
// A ScriptWrappable rather than a dictionary: WebIDL will not have a dictionary
// as the type of an attribute, and these are read off
// `navigator.domicile.displays`.
//
// Its geometry is logical -- the CSS pixels a shell lays out in -- and `scale`
// is what *clients* on this screen draw at, not the shell's own density.
//
// Immutable. The compositor re-describes the whole desktop when any of it
// changes -- a resize, a density change, a config reload -- so a display is
// replaced rather than edited, and a shell holding one from a previous
// description is holding a fact about a desktop that no longer exists.
class MODULES_EXPORT DomicileDisplay final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileDisplay(const String& name,
                  int32_t x,
                  int32_t y,
                  uint32_t width,
                  uint32_t height,
                  uint32_t scale);
  ~DomicileDisplay() override;

  const String& name() const { return name_; }
  int32_t x() const { return x_; }
  int32_t y() const { return y_; }
  uint32_t width() const { return width_; }
  uint32_t height() const { return height_; }
  uint32_t scale() const { return scale_; }

  void Trace(Visitor*) const override;

 private:
  String name_;
  int32_t x_ = 0;
  int32_t y_ = 0;
  uint32_t width_ = 0;
  uint32_t height_ = 0;
  uint32_t scale_ = 1;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_DISPLAY_H_
