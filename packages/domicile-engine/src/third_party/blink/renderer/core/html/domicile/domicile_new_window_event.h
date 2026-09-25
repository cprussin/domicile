// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_NEW_WINDOW_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_NEW_WINDOW_EVENT_H_

#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// The page inside a <webview> asked for a window of its own.
//
// THE ONE <webview> EVENT WITH A PAYLOAD, and the reason it has one is the
// reason the other three do not. `domicile-history-change` and
// `domicile-loading-change` announce a change to state the element already
// holds, so a chrome reads `canGoBack` or `loading` at the moment it renders
// and an event's detail would be a second copy of an answer that is right only
// at the instant it was made. There is no such state here: what the page asked
// for is an address, there is no element showing it yet -- making one is the
// whole of what is being asked -- and a property holding "the last window
// somebody asked for" would be a lie between asks and would lose the second of
// two links opened in a row.
//
// A REAL EVENT TYPE RATHER THAN A CustomEvent CARRYING A DETAIL BAG, which is
// the same call the fork's control-channel events make: a shell reads
// `event.url` and parses nothing. See
// third_party/blink/renderer/modules/domicile/domicile_app_titled_event.h.
//
// IN core/ RATHER THAN modules/, unlike every other event this fork defines,
// because the element that dispatches it is a core element and core cannot
// depend on modules. That is also why this has no constructor and no
// `…EventInit` dictionary beside it: nothing but the browser process ever makes
// one, and a dictionary is two more generated files in three more build lists
// for a constructor no shell calls.
//
// WHAT THE WINDOW IS NOT: content did not make one. The browser refuses the
// window a guest's page asks for -- a guest has no SiteInstance of its own, and
// content CHECKs that pair -- and reports the address instead, so what a shell
// does with this is open a browser window of its own and point a second
// <webview> at `url`. components/domicile/browser/web_view_guest.h has the
// decision and what it costs.
class CORE_EXPORT DomicileNewWindowEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileNewWindowEvent(const AtomicString& type, const String& url);
  ~DomicileNewWindowEvent() override;

  // The address the page asked to open, absolute: the browser process resolved
  // it against the document that asked before it ever reached this process.
  const String& url() const { return url_; }

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  String url_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_NEW_WINDOW_EVENT_H_
