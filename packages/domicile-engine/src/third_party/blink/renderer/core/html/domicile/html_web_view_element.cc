// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"

#include "third_party/blink/renderer/core/frame/history.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/core/frame/local_frame.h"
#include "third_party/blink/renderer/core/html_names.h"
#include "third_party/blink/renderer/core/layout/layout_iframe.h"
#include "third_party/blink/renderer/core/loader/frame_load_request.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"

namespace blink {

HTMLWebViewElement::HTMLWebViewElement(Document& document)
    : HTMLFrameElementBase(html_names::kWebviewTag, document) {}

HTMLWebViewElement::~HTMLWebViewElement() = default;

LayoutObject* HTMLWebViewElement::CreateLayoutObject(
    const ComputedStyle& style) {
  return MakeGarbageCollected<LayoutIFrame>(this);
}

network::ParsedPermissionsPolicy HTMLWebViewElement::ConstructContainerPolicy()
    const {
  // No `allow` attribute, so nothing is delegated: the nested context gets the
  // policy it would get from an <iframe> with no allow list. A shell that needs
  // to hand a feature down should say so explicitly, and that is a change worth
  // making deliberately rather than by inheriting a permissive default.
  return network::ParsedPermissionsPolicy();
}

// The history controls. A <webview> that has not loaded yet -- or whose frame
// has gone away, or is out of process -- does nothing rather than throwing at a
// shell that is driving it from an address bar.
//
// Note that session history is joint: back() on a nested context traverses the
// whole session's history, not a per-<webview> stack. Electron's <webview> had
// a history of its own because it was a WebContents of its own; this is a frame,
// and a frame shares.
LocalDOMWindow* HTMLWebViewElement::ContentWindow() const {
  LocalFrame* frame = DynamicTo<LocalFrame>(ContentFrame());
  return frame ? frame->DomWindow() : nullptr;
}

void HTMLWebViewElement::goBack(ScriptState* script_state,
                                ExceptionState& exception_state) {
  if (LocalDOMWindow* window = ContentWindow()) {
    window->history()->back(script_state, exception_state);
  }
}

void HTMLWebViewElement::goForward(ScriptState* script_state,
                                   ExceptionState& exception_state) {
  if (LocalDOMWindow* window = ContentWindow()) {
    window->history()->forward(script_state, exception_state);
  }
}

void HTMLWebViewElement::stop() {
  if (LocalFrame* frame = DynamicTo<LocalFrame>(ContentFrame())) {
    frame->Loader().StopAllLoaders(/*abort_client=*/true);
  }
}

void HTMLWebViewElement::reload() {
  if (LocalFrame* frame = DynamicTo<LocalFrame>(ContentFrame())) {
    frame->Reload(WebFrameLoadType::kReload);
  }
}

}  // namespace blink
