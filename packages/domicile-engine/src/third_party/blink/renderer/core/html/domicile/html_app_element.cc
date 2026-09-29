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
    // A different window in the same box. The surface the layer is pointed at
    // is replaced rather than torn down, so the element keeps its box and its
    // place in the layer tree across the change.
    ForgetEmbedIfMirroring();
    Embed();
    return;
  }
  if (params.name == html_names::kMirrorAttr) {
    // Handed from one page to another: the window's middle crossed the edge
    // between two monitors, so the page it left mirrors it and the page it
    // reached configures it. Either way what was asked before is the wrong
    // question now.
    reallocate_ = params.new_value.IsNull();
    ForgetEmbed();
    Embed();
    return;
  }
  HTMLElement::ParseAttribute(params);
}

Node::InsertionNotificationRequest HTMLAppElement::InsertedInto(
    ContainerNode& insertion_point) {
  // Nothing to embed into yet -- there is no box until layout runs, and the box
  // is what the producer is configured at. LayoutAppSurface calls
  // SurfaceBoxChanged() when there is one.
  return HTMLElement::InsertedInto(insertion_point);
}

void HTMLAppElement::RemovedFrom(ContainerNode& insertion_point) {
  // The layer goes with the layout object. The embedder is kept: an element
  // moved between parents is the same window, and dropping the embedder would
  // make the browser hold a fresh reply until the producer reconnected -- which
  // for a client that is already running it never does.
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
  // A placeholder until the surface resolves, so the element has a layer to be
  // laid out and composited with from its first frame.
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
  // No box yet. Embedding at 0x0 would configure the client at 0x0, and a
  // Wayland client asked for that draws nothing; the reply is worth waiting for
  // layout over.
  if (configured_size_.IsEmpty()) {
    return;
  }
  if (!surface_layer_bridge_ && !CreateLayer()) {
    return;
  }

  // One ask at a time. The browser holds the reply until a producer has been
  // brokered a sink for this app, so asks do not overtake each other and a
  // second one would simply queue -- against an app id or a size that may
  // itself be stale by the time it is answered.
  if (embed_in_flight_) {
    embed_stale_ = true;
    return;
  }

  if (FastHasAttribute(html_names::kMirrorAttr)) {
    Mirror(app_id, *frame);
    return;
  }

  const bool reconfiguring = !!external_surface_embedder_ || reallocate_;
  reallocate_ = false;
  if (!external_surface_embedder_) {
    external_surface_embedder_ = std::make_unique<ExternalSurfaceEmbedder>();
  }
  embed_in_flight_ = true;
  embed_stale_ = false;
  external_surface_embedder_->Embed(
      app_id,
      frame->GetPage()->GetChromeClient().GetFrameSinkId(frame),
      configured_size_,
      // THE SCALE THE BOX IS IN, because the box is in device pixels and a
      // client is configured in logical ones. Said here rather than left to
      // the compositor to guess: a desk of several monitors is several pages,
      // each at its own monitor's scale, and only this one knows which.
      frame->LayoutZoomFactor(),
      reconfiguring ? ExternalSurfaceEmbedder::Allocation::kReconfigure
                    : ExternalSurfaceEmbedder::Allocation::kAdopt,
      BindOnce(&HTMLAppElement::OnEmbedded, WrapPersistent(this)));
}

void HTMLAppElement::OnEmbedded(
    const std::optional<viz::SurfaceId>& surface_id) {
  embed_in_flight_ = false;
  if (surface_id && surface_layer_bridge_) {
    // SurfaceLayerBridge::EmbedSurface() takes a SurfaceId and does not ask
    // whose it is, and neither does cc::SurfaceLayer::SetSurfaceId under it.
    // From here the window is an ordinary layer.
    surface_layer_bridge_->EmbedSurface(*surface_id);
  }
  if (embed_stale_) {
    // app-id or the box moved while this was outstanding, so what just landed
    // is the answer to a question no longer being asked.
    Embed();
  }
}

void HTMLAppElement::Mirror(const AtomicString& app_id, LocalFrame& frame) {
  // Asked once; the browser tells it every surface after that.
  if (external_surface_embedder_) {
    return;
  }
  external_surface_embedder_ = std::make_unique<ExternalSurfaceEmbedder>();
  external_surface_embedder_->Mirror(
      app_id, frame.GetPage()->GetChromeClient().GetFrameSinkId(&frame),
      BindRepeating(&HTMLAppElement::OnMirrored, WrapWeakPersistent(this)));
}

void HTMLAppElement::OnMirrored(const viz::SurfaceId& surface_id) {
  // The surface is the size the other page configured it at, and the layer
  // stretches it to this box: a monitor at another scale draws the same
  // window at its own density rather than resizing the client to it.
  if (surface_layer_bridge_) {
    surface_layer_bridge_->EmbedSurface(surface_id);
  }
}

void HTMLAppElement::ForgetEmbed() {
  // Dropping the embedder closes its pipes, which is how the browser hears a
  // mirror stop, and an answer still in flight goes with them -- so nothing
  // is waiting for it either.
  external_surface_embedder_.reset();
  embed_in_flight_ = false;
  embed_stale_ = false;
}

void HTMLAppElement::ForgetEmbedIfMirroring() {
  // A mirror is asked once for one app; a different app is a different ask.
  if (FastHasAttribute(html_names::kMirrorAttr)) {
    ForgetEmbed();
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
