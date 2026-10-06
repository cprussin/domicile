// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

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

// <app>: a Wayland client's window, laid out by the page.
//
// A cc::SurfaceLayer embeds the viz surface that domicile-compositor submits
// the client's dmabuf to, as out-of-process <iframe>s do. The layer sits in the
// page's property trees, so CSS z-index, transform, clip, opacity, filter and
// blend apply to the window. See
// docs/architecture/ENGINE-FORK.md#embedding-in-the-page.
//
// A built-in element because custom element names need a hyphen. The reflected
// `app-id` attribute selects the window.
class CORE_EXPORT HTMLAppElement final : public HTMLElement,
                                         public WebSurfaceLayerBridgeObserver {
  DEFINE_WRAPPERTYPEINFO();

 public:
  explicit HTMLAppElement(Document&);
  ~HTMLAppElement() override;

  // Required for `DynamicTo` and `IsA`. Without it every downcast returns null
  // and nothing fails to build. scripts/test-fork-elements-know-their-type.sh
  // checks it.
  ElementType GetElementType() const final {
    return ElementType::kHTMLAppElement;
  }

  // The surface's layer, or null before one exists. Only the layout object
  // should use it.
  cc::Layer* ContentsCcLayer() const;

  // Called by LayoutAppSurface after layout. The box size becomes the client's
  // xdg_toplevel.configure size.
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

  // Requests the SurfaceId of `app-id`'s window and embeds it. A no-op without
  // a frame, an app-id or a box; each is a normal state before the first frame.
  void Embed();
  void OnEmbedded(const std::optional<viz::SurfaceId>&);

  bool CreateLayer();

  // The size last sent to the producer, so an unchanged relayout does not
  // resize the client.
  gfx::Size configured_size_;

  // An Embed() is awaiting its reply. The reply may never come if no producer
  // connects, and a second request would queue behind it.
  bool embed_in_flight_ = false;

  // app-id or the box changed while a reply was pending. Re-embed when it
  // arrives.
  bool embed_stale_ = false;

  std::unique_ptr<::blink::SurfaceLayerBridge> surface_layer_bridge_;
  std::unique_ptr<ExternalSurfaceEmbedder> external_surface_embedder_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_HTML_APP_ELEMENT_H_
