// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_LAYER_SCRIPT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_LAYER_SCRIPT_H_

#include "v8/include/v8-local-handle.h"
#include "v8/include/v8-value.h"

namespace blink {

class LocalDOMWindow;

// Evaluates the SDK's desktop layer (`domicile_layer.js`) in `window`'s main
// world and returns its `{ appDesktop, desktop }`, or an empty handle if it
// threw. Call inside a ScriptState::Scope for that world.
//
// The layer turns the WebIDL host into the typed, namespaced object a module
// is handed, so a shell or an app never sees the host itself. It is evaluated
// without binding it to any name, as kRunShell is, so the page cannot find it.
v8::Local<v8::Value> EvaluateDomicileLayer(LocalDOMWindow& window);

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_LAYER_SCRIPT_H_
