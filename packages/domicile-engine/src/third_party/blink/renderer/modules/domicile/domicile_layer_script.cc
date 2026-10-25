// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_layer_script.h"

#include "third_party/blink/renderer/bindings/core/v8/script_evaluation_result.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/core/script/classic_script.h"
#include "third_party/blink/renderer/modules/domicile/domicile_layer.h"

namespace blink {

v8::Local<v8::Value> EvaluateDomicileLayer(LocalDOMWindow& window) {
  // ASCII, so reading it as Latin-1 reads it right; see make_domicile_layer.py.
  return ClassicScript::Create(kDomicileLayer, window.Url(), window.Url(),
                               ScriptFetchOptions())
      ->RunScriptAndReturnValue(&window)
      .GetSuccessValueOrEmpty();
}

}  // namespace blink
