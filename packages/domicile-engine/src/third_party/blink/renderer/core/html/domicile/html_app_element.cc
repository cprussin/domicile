// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/html_app_element.h"

#include <cmath>
#include <optional>

#include "base/functional/callback_helpers.h"
#include "base/notreached.h"
#include "cc/layers/deadline_policy.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/event_type_names.h"
#include "third_party/blink/renderer/core/events/mouse_event.h"
#include "third_party/blink/renderer/core/events/pointer_event.h"
#include "third_party/blink/renderer/core/events/wheel_event.h"
#include "third_party/blink/renderer/core/frame/local_frame.h"
#include "third_party/blink/renderer/core/html/domicile/layout_app_surface.h"
#include "third_party/blink/renderer/core/html_names.h"
#include "third_party/blink/renderer/core/layout/layout_object.h"
#include "third_party/blink/renderer/core/layout/layout_replaced.h"
#include "third_party/blink/renderer/core/page/chrome_client.h"
#include "third_party/blink/renderer/core/page/page.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/heap/persistent.h"
#include "third_party/blink/renderer/platform/wtf/functional.h"

namespace blink {

namespace {

// Linux input-event-codes.h, for MouseEvent.button's 0 primary, 1 auxiliary
// and 2 secondary. Any other button has no code a client is sent.
std::optional<uint32_t> LinuxButton(int16_t button) {
  switch (button) {
    case 0:
      return 0x110;  // BTN_LEFT
    case 1:
      return 0x112;  // BTN_MIDDLE
    case 2:
      return 0x111;  // BTN_RIGHT
    default:
      return std::nullopt;
  }
}

// `wl_pointer.axis_value120` counts 120 per detent of a classic wheel, and a
// detent scrolls 100 pixels, 3 lines or 1 page -- the conventions browsers use.
constexpr double kValue120PerDetent = 120;
constexpr double kPixelsPerDetent = 100;

double PerDetent(unsigned delta_mode) {
  switch (delta_mode) {
    case WheelEvent::kDomDeltaPixel:
      return kPixelsPerDetent;
    case WheelEvent::kDomDeltaLine:
      return 3;
    case WheelEvent::kDomDeltaPage:
      return 1;
  }
  NOTREACHED();
}

// Multiplied before divided, so a whole number of detents stays exact: the
// commonest wheel is a pixel one, whose delta has to pass through untouched.
double Rescale(double delta, double target, double per_detent) {
  return delta * target / per_detent;
}

// JavaScript's Math.round, which halves upward, rather than std::lround,
// which halves away from zero: the value a scroll of -2.5 steps was sent as.
int32_t RoundHalfUp(double value) {
  return static_cast<int32_t>(std::floor(value + 0.5));
}

}  // namespace

const char AppInputClient::kSupplementName[] = "AppInputClient";

AppInputClient* AppInputClient::From(LocalDOMWindow& window) {
  return Supplement<LocalDOMWindow>::From<AppInputClient>(window);
}

AppInputClient::AppInputClient(LocalDOMWindow& window)
    : Supplement<LocalDOMWindow>(window) {}

void AppInputClient::Trace(Visitor* visitor) const {
  Supplement<LocalDOMWindow>::Trace(visitor);
}

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
  const viz::LocalSurfaceId local_surface_id =
      external_surface_embedder_->Embed(
          app_id,
          frame->GetPage()->GetChromeClient().GetFrameSinkId(frame),
          configured_size_,
          // The box is in device pixels and the client is configured in logical
          // ones. Each monitor's page has its own scale, so the page sends it.
          frame->LayoutZoomFactor(),
          reconfiguring ? ExternalSurfaceEmbedder::Allocation::kReconfigure
                        : ExternalSurfaceEmbedder::Allocation::kAdopt,
          BindOnce(&HTMLAppElement::OnEmbedded, WrapPersistent(this), app_id));

  // A shown window resized: its frame sink is known, so embed the surface for
  // the new box in the frame whose layout changed it. Viz holds that frame
  // until the client draws at the new size, up to the default deadline, so the
  // box and the window change together instead of the old frame stretching.
  if (app_id == embedded_app_id_) {
    surface_layer_bridge_->EmbedSurface(
        viz::SurfaceId(surface_layer_bridge_->GetSurfaceId().frame_sink_id(),
                       local_surface_id),
        cc::DeadlinePolicy::UseDefaultDeadline());
  }
}

void HTMLAppElement::OnEmbedded(
    const AtomicString& app_id,
    const std::optional<viz::SurfaceId>& surface_id) {
  embed_in_flight_ = false;
  // Embedding the id Embed() already did would drop its deadline.
  if (surface_id && surface_layer_bridge_ &&
      *surface_id != surface_layer_bridge_->GetSurfaceId()) {
    // SurfaceLayerBridge accepts any SurfaceId, so the window becomes an
    // ordinary layer.
    surface_layer_bridge_->EmbedSurface(*surface_id);
  }
  embedded_app_id_ = surface_id ? app_id : g_null_atom;
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

// THE DEFAULT HANDLING, rather than a listener, which is what makes a page's
// own handling come first. Every listener on the page has had the event --
// a shell's container, its document, a React root -- before this runs, and a
// page that called `preventDefault()` has taken it: the press that starts an
// Alt-drag never reaches the client under it. It is also why a page cannot
// click into a client by script: Blink runs default handlers for trusted
// events only.
//
// Only for events aimed at this element. An <app> is a replaced element with
// no rendered children, so that is every event over it.
void HTMLAppElement::DefaultEventHandler(Event& event) {
  // A copy: a handler run from here can rewrite the attribute.
  const AtomicString app_id = FastGetAttribute(html_names::kAppIdAttr);
  LocalDOMWindow* window = GetDocument().domWindow();
  AppInputClient* client = window ? AppInputClient::From(*window) : nullptr;
  if (event.RawTarget() != this || app_id.empty() || !client) {
    HTMLElement::DefaultEventHandler(event);
    return;
  }
  // The menu the secondary button would open, which is the browser answering
  // a press already given away: the right button over a window is the
  // client's, and its own menu is drawn inside its own surface. Taken here and
  // nowhere else -- a page's own `contextmenu` listener still hears it, and a
  // right-click off every window still gets the page's menu.
  if (event.type() == event_type_names::kContextmenu) {
    event.SetDefaultHandled();
    return;
  }
  ForwardInput(*client, app_id, event);
  HTMLElement::DefaultEventHandler(event);
}

void HTMLAppElement::ForwardInput(AppInputClient& client,
                                  const String& app_id,
                                  const Event& event) {
  const AtomicString& type = event.type();
  if (type == event_type_names::kWheel) {
    if (const auto* wheel = DynamicTo<WheelEvent>(event)) {
      const double per_detent = PerDetent(wheel->deltaMode());
      client.AppPointerAxis(
          app_id, Rescale(wheel->deltaX(), kPixelsPerDetent, per_detent),
          Rescale(wheel->deltaY(), kPixelsPerDetent, per_detent),
          RoundHalfUp(Rescale(wheel->deltaX(), kValue120PerDetent, per_detent)),
          RoundHalfUp(
              Rescale(wheel->deltaY(), kValue120PerDetent, per_detent)));
    }
    return;
  }
  // `PointerEvent`, not `MouseEvent`: a `PointerEvent` says it is no
  // `MouseEvent` for every type but click, auxclick and contextmenu
  // (PointerEvent::IsMouseEvent), so `DynamicTo<MouseEvent>` is null for the
  // four handled below.
  const auto* pointer = DynamicTo<PointerEvent>(event);
  if (!pointer) {
    return;
  }
  if (type == event_type_names::kPointermove) {
    ForwardMotion(client, app_id, *pointer);
  } else if (type == event_type_names::kPointerdown) {
    // Asked first: a click is the user reaching for this window, and the
    // keyboard follows it unless the shell says otherwise. Then where the
    // press is, then the press.
    client.AppPressed(*this, app_id);
    ForwardMotion(client, app_id, *pointer);
    if (const std::optional<uint32_t> button = LinuxButton(pointer->button())) {
      client.AppPointerButton(app_id, *button, true);
    }
  } else if (type == event_type_names::kPointerup) {
    if (const std::optional<uint32_t> button = LinuxButton(pointer->button())) {
      client.AppPointerButton(app_id, *button, false);
    }
  } else if (type == event_type_names::kPointerout) {
    // `pointerout` rather than `pointerleave`: the two differ only for a
    // pointer moving into a descendant, and this element renders none. Moving
    // from one window straight to another tells the one left before the one
    // arrived at.
    client.AppPointerLeave(app_id);
  }
}

// Motion is the one forward that needs a box: without one there is no point
// on the surface to report, where a press and a release still mean something.
void HTMLAppElement::ForwardMotion(AppInputClient& client,
                                   const String& app_id,
                                   const MouseEvent& event) {
  gfx::PointF point;
  gfx::SizeF size;
  if (MapToContent(event, point, size)) {
    client.AppPointerMotion(app_id, point, size);
  }
}

// THE WHOLE TRANSFORM, INVERTED BY THE ENGINE THAT APPLIED IT. Every transform
// between this box and the document -- this element's own, each ancestor's,
// `zoom`, a perspective, the top layer's break from its ancestors -- is in the
// layout tree's mapping, which is what `MouseEvent.offsetX` is computed with.
// The same pairing as there: the event's absolute location, mapped into this
// layout object. Script had to reassemble this from `getBoundingClientRect`
// and computed styles, and could not follow a projection at all.
//
// The content box rather than the border box, because that is where the
// surface is drawn (LayoutAppSurface::PaintReplaced).
bool HTMLAppElement::MapToContent(const MouseEvent& event,
                                  gfx::PointF& point,
                                  gfx::SizeF& size) {
  GetDocument().UpdateStyleAndLayout(DocumentUpdateReason::kInput);
  const auto* box = DynamicTo<LayoutReplaced>(GetLayoutObject());
  if (!box) {
    return false;
  }
  const PhysicalRect content = box->ReplacedContentRect();
  if (content.IsEmpty()) {
    return false;
  }
  // Layout pixels are the element's CSS pixels times its effective zoom,
  // which is the page's zoom and every CSS `zoom` above it compounded.
  const float zoom = box->StyleRef().EffectiveZoom();
  const gfx::PointF local =
      box->AbsoluteToLocalPoint(event.AbsoluteLocation()) -
      gfx::Vector2dF(content.offset);
  point = gfx::ScalePoint(local, 1 / zoom);
  size = gfx::ScaleSize(gfx::SizeF(content.size), 1 / zoom);
  // A transform that cannot be inverted maps to nothing worth sending.
  return std::isfinite(point.x()) && std::isfinite(point.y());
}

void HTMLAppElement::Trace(Visitor* visitor) const {
  HTMLElement::Trace(visitor);
}

}  // namespace blink
