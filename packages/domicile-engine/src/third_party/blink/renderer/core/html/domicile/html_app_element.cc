// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/html_app_element.h"

#include "base/functional/callback_helpers.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/frame/local_frame.h"
#include "third_party/blink/renderer/core/html/domicile/layout_app_surface.h"
#include "third_party/blink/renderer/core/html_names.h"
#include "third_party/blink/renderer/core/layout/layout_object.h"
#include "third_party/blink/renderer/core/page/chrome_client.h"
#include "third_party/blink/renderer/core/page/page.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/heap/persistent.h"
#include "third_party/blink/renderer/platform/wtf/functional.h"

namespace blink {

HTMLAppElement::HTMLAppElement(Document& document)
    : HTMLElement(html_names::kAppTag, document) {}

HTMLAppElement::~HTMLAppElement() = default;

LayoutObject* HTMLAppElement::CreateLayoutObject(const ComputedStyle& style) {
  return MakeGarbageCollected<LayoutAppSurface>(this);
}

cc::Layer* HTMLAppElement::ContentsCcLayer() const {
  return surface_layer_bridge_ ? surface_layer_bridge_->GetCcLayer() : nullptr;
}

void HTMLAppElement::ParseAttribute(
    const AttributeModificationParams& params) {
  if (params.name == html_names::kAppIdAttr) {
    // Re-embed into the existing layer so the element keeps its box and its
    // place in the layer tree.
    Embed();
    return;
  }
  HTMLElement::ParseAttribute(params);
}

Node::InsertionNotificationRequest HTMLAppElement::InsertedInto(
    ContainerNode& insertion_point) {
  // No box until layout runs. LayoutAppSurface calls SurfaceBoxChanged() then.
  return HTMLElement::InsertedInto(insertion_point);
}

void HTMLAppElement::RemovedFrom(ContainerNode& insertion_point) {
  // Keep the embedder: a moved element shows the same window. A new embedder
  // would wait for the producer to reconnect, which a running client never
  // does.
  HTMLElement::RemovedFrom(insertion_point);
}

void HTMLAppElement::SurfaceBoxChanged(const gfx::Size& size) {
  if (size == configured_size_) {
    return;
  }
  configured_size_ = size;
  Embed();
}

bool HTMLAppElement::CreateLayer() {
  DCHECK(!surface_layer_bridge_);
  LocalFrame* frame = GetDocument().GetFrame();
  if (!frame || !frame->GetPage()) {
    return false;
  }
  surface_layer_bridge_ = std::make_unique<::blink::SurfaceLayerBridge>(
      frame->GetPage()->GetChromeClient().GetFrameSinkId(frame), this,
      base::NullCallback());
  // Placeholder so the element has a layer from its first frame.
  surface_layer_bridge_->CreateSolidColorLayer();
  SetNeedsCompositingUpdate();
  return true;
}

void HTMLAppElement::Embed() {
  const AtomicString& app_id = FastGetAttribute(html_names::kAppIdAttr);
  if (app_id.empty()) {
    return;
  }
  LocalFrame* frame = GetDocument().GetFrame();
  if (!frame || !frame->GetPage()) {
    return;
  }
  // Wait for layout. A Wayland client configured at 0x0 draws nothing.
  if (configured_size_.IsEmpty()) {
    return;
  }
  if (!surface_layer_bridge_ && !CreateLayer()) {
    return;
  }

  // One request at a time. The browser holds the reply until a producer
  // connects, so a second request would queue with possibly stale arguments.
  // OnEmbedded() retries instead.
  if (embed_in_flight_) {
    embed_stale_ = true;
    return;
  }

  const bool reconfiguring = !!external_surface_embedder_;
  if (!reconfiguring) {
    external_surface_embedder_ = std::make_unique<ExternalSurfaceEmbedder>();
  }
  embed_in_flight_ = true;
  embed_stale_ = false;
  external_surface_embedder_->Embed(
      app_id,
      frame->GetPage()->GetChromeClient().GetFrameSinkId(frame),
      configured_size_,
      // The box is in device pixels and the client is configured in logical
      // ones. Each monitor's page has its own scale, so the page sends it.
      frame->LayoutZoomFactor(),
      reconfiguring ? ExternalSurfaceEmbedder::Allocation::kReconfigure
                    : ExternalSurfaceEmbedder::Allocation::kAdopt,
      BindOnce(&HTMLAppElement::OnEmbedded, WrapPersistent(this)));
}

void HTMLAppElement::OnEmbedded(
    const std::optional<viz::SurfaceId>& surface_id) {
  embed_in_flight_ = false;
  if (surface_id && surface_layer_bridge_) {
    // SurfaceLayerBridge accepts any SurfaceId, so the window becomes an
    // ordinary layer.
    surface_layer_bridge_->EmbedSurface(*surface_id);
  }
  if (embed_stale_) {
    // app-id or the box changed while the request was in flight.
    Embed();
  }
}

void HTMLAppElement::OnWebLayerUpdated() {
  SetNeedsCompositingUpdate();
}

void HTMLAppElement::RegisterContentsLayer(cc::Layer* layer) {
  SetNeedsCompositingUpdate();
}

void HTMLAppElement::UnregisterContentsLayer(cc::Layer* layer) {
  SetNeedsCompositingUpdate();
}

void HTMLAppElement::Trace(Visitor* visitor) const {
  HTMLElement::Trace(visitor);
}

}  // namespace blink
