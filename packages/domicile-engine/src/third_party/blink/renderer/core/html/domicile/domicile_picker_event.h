// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PICKER_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PICKER_EVENT_H_

#include "components/domicile/mojom/web_view_guest.mojom-blink.h"
#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/platform/heap/member.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"
#include "ui/gfx/geometry/rect.h"

namespace blink {

class ExceptionState;
class HTMLWebViewElement;

// Asks the shell to draw a picker for a form control in the page inside a
// <webview>. Held and answered as DomicilePromptEvent is: claimed with
// `preventDefault()`, canceled if unclaimed, one answer only.
class CORE_EXPORT DomicilePickerEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  using Answer =
      domicile::mojom::blink::WebViewGuestClient::PickerRequestedCallback;

  DomicilePickerEvent(const AtomicString& type,
                      const domicile::mojom::blink::WebViewPicker& picker,
                      Answer answer,
                      HTMLWebViewElement& owner);
  ~DomicilePickerEvent() override;

  const String& kind() const { return kind_; }
  const String& value() const { return value_; }
  const String& min() const { return min_; }
  const String& max() const { return max_; }
  const String& step() const { return step_; }
  const Vector<String>& options() const { return options_; }
  const Vector<String>& labels() const { return labels_; }
  int32_t anchorX() const { return anchor_.x(); }
  int32_t anchorY() const { return anchor_.y(); }
  int32_t anchorWidth() const { return anchor_.width(); }
  int32_t anchorHeight() const { return anchor_.height(); }

  void choose(const String& value, ExceptionState&);
  void cancel(ExceptionState&);

  // Called by the element for an unclaimed event, a withdrawn one and one a
  // newer picker replaced. Keeps the old value.
  void CancelIfUnanswered();

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  void Run(bool picked, const String& value);

  String kind_;
  String value_;
  String min_;
  String max_;
  String step_;
  Vector<String> options_;
  Vector<String> labels_;
  gfx::Rect anchor_;
  // Null once answered.
  Answer answer_;
  // Notified on answer so it releases this event.
  Member<HTMLWebViewElement> owner_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PICKER_EVENT_H_
