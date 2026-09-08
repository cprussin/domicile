// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_APP_ELEMENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_APP_ELEMENT_H_

#include <memory>
#include <optional>

#include "components/viz/common/surfaces/surface_id.h"
#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/html/html_element.h"
#include "third_party/blink/renderer/platform/graphics/external_surface_embedder.h"
#include "third_party/blink/renderer/platform/graphics/surface_layer_bridge.h"
#include "ui/gfx/geometry/size.h"

namespace blink {

// <app> — a window belonging to a Wayland client, laid out by this page.
//
// It is a cc::SurfaceLayer embedding a viz surface that domicile-compositor
// submits the client's dmabuf to, which is the same mechanism an out-of-process
// <iframe> and a hardware-decoded <video> use. That is the point: the layer
// goes into this page's property trees with every other layer, so z-index,
// transform, clip, opacity, filter and blend apply to a window structurally
// rather than being reimplemented against it. See
// docs/architecture/ENGINE-FORK.md in the Domicile repository.
//
// Why an element and not a custom element: a custom element's name must contain
// a hyphen, per spec, and the tag a shell author writes is <app>. So the fork
// defines it, the way Electron's <webview> was defined.
//
// `app-id` says which window. It is a reflected content attribute, the way
// <img src> is, so setting it in HTML and setting it from script are the same
// operation and re-point the element at another client's surface.
class CORE_EXPORT HTMLAppElement final : public HTMLElement,
                                         public WebSurfaceLayerBridgeObserver {
  DEFINE_WRAPPERTYPEINFO();

 public:
  explicit HTMLAppElement(Document&);
  ~HTMLAppElement() override;

  // The layer the surface is embedded in, or null before one exists. The
  // layout object records it as a foreign layer; nothing else should hold it.
  cc::Layer* ContentsCcLayer() const;

  // Called by LayoutAppSurface once layout has a box, and again whenever that
  // box changes size. The box is what the producer is told to render at: for an
  // <app> the layout box *is* the xdg_toplevel.configure.
  void SurfaceBoxChanged(const gfx::Size& size);

  // WebSurfaceLayerBridgeObserver:
  void OnWebLayerUpdated() override;
  void RegisterContentsLayer(cc::Layer*) override;
  void UnregisterContentsLayer(cc::Layer*) override;

  void Trace(Visitor*) const override;

 private:
  LayoutObject* CreateLayoutObject(const ComputedStyle&) override;
  void ParseAttribute(const AttributeModificationParams&) override;
  InsertionNotificationRequest InsertedInto(ContainerNode&) override;
  void RemovedFrom(ContainerNode&) override;

  // Ask the browser for the SurfaceId of `app-id`'s window and embed it.
  // A no-op without a frame, without an app-id, or before layout has given the
  // element a box -- each of which is a state the element passes through on the
  // way to its first frame rather than an error.
  void Embed();
  void OnEmbedded(const std::optional<viz::SurfaceId>&);

  bool CreateLayer();

  // The size last sent to the producer. Kept so that a layout that did not
  // change the box does not reconfigure the client, which would make every
  // relayout of the page a resize of every window on it.
  gfx::Size configured_size_;

  // Whether an Embed() has been asked for and not yet answered. The browser
  // holds the reply until a producer connects for this app id, which may be
  // never, so a second ask would queue behind the first rather than replace it.
  bool embed_in_flight_ = false;

  // Set when app-id or the box changed while a reply was outstanding: the
  // answer in flight is for the wrong app or the wrong size, so re-ask once it
  // lands.
  bool embed_stale_ = false;

  std::unique_ptr<::blink::SurfaceLayerBridge> surface_layer_bridge_;
  std::unique_ptr<ExternalSurfaceEmbedder> external_surface_embedder_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_APP_ELEMENT_H_
