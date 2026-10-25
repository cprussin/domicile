// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CAST_SINK_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CAST_SINK_H_

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// A TV the desktop can cast to, as the browser listed it.
//
// Immutable, like DomicileBrowserWindow, and for its reason.
class MODULES_EXPORT DomicileCastSink final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  // `route` is a null String while no cast runs.
  DomicileCastSink(const String& id, const String& name, const String& route);
  ~DomicileCastSink() override;

  const String& id() const { return id_; }
  const String& name() const { return name_; }
  const String& route() const { return route_; }

  void Trace(Visitor*) const override;

 private:
  String id_;
  String name_;
  String route_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CAST_SINK_H_
