// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_DEVICE_REQUEST_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_DEVICE_REQUEST_EVENT_H_

#include <cstdint>
#include <optional>
#include <utility>

#include "components/domicile/mojom/web_view_guest.mojom-blink.h"
#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/platform/heap/collection_support/heap_vector.h"
#include "third_party/blink/renderer/platform/heap/member.h"
#include "third_party/blink/renderer/platform/wtf/hash_set.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace blink {

class DomicileDevice;
class ExceptionState;
class HTMLWebViewElement;

// Asks the shell to pick a device for the page inside a <webview>.
//
// - Carries the browser's reply callback, as DomicilePermissionRequestEvent
//   does. The browser expects one answer, so a second throws
//   InvalidStateError.
// - A shell claims it with `preventDefault()`. The element cancels an
//   unclaimed one after dispatch, so a shell that does not listen leaves the
//   page with no device.
// - The element holds it until answered or withdrawn, for the callback, and
//   updates its devices as the browser offers them.
class CORE_EXPORT DomicileDeviceRequestEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  using Answer =
      domicile::mojom::blink::WebViewGuestClient::DeviceRequestedCallback;

  DomicileDeviceRequestEvent(const AtomicString& type,
                             const String& title,
                             bool multiple,
                             Answer answer,
                             HTMLWebViewElement& owner);
  ~DomicileDeviceRequestEvent() override;

  const String& title() const { return title_; }
  bool multiple() const { return multiple_; }
  bool listed() const { return listed_; }
  HeapVector<Member<DomicileDevice>> devices() const;

  void choose(const Vector<int32_t>& ids, ExceptionState&);
  void cancel(ExceptionState&);

  // Called by the element for each DevicesOffered.
  void Offer(const Vector<domicile::mojom::blink::WebViewDevicePtr>& devices);

  // Called by the element: for an event no shell claimed, and when the browser
  // withdraws the request. Answers that nothing was picked.
  void CancelIfUnanswered();

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  void Run(const std::optional<Vector<int32_t>>& chosen);

  String title_;
  bool multiple_;
  bool listed_ = false;
  // The devices offered now, as id and name.
  Vector<std::pair<int32_t, String>> devices_;
  // Every id offered, including devices since removed. Ids start at 1. The
  // shell may pick one it was shown just before it was unplugged; the browser
  // drops it.
  HashSet<int32_t> offered_;
  // Null once answered.
  Answer answer_;
  // Notified on answer so it releases this event.
  Member<HTMLWebViewElement> owner_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_DEVICE_REQUEST_EVENT_H_
