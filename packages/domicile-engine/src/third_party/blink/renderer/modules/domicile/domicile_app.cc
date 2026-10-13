// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_app.h"

#include <iterator>
#include <tuple>
#include <utility>

#include "base/functional/callback.h"
#include "components/domicile/common/domicile_scheme.h"
#include "third_party/blink/renderer/bindings/core/v8/script_evaluation_result.h"
#include "third_party/blink/renderer/bindings/core/v8/to_v8_traits.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_binding_for_core.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_script_runner.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/dom/element_traversal.h"
#include "third_party/blink/renderer/core/dom/events/native_event_listener.h"
#include "third_party/blink/renderer/core/event_type_names.h"
#include "third_party/blink/renderer/core/html/html_meta_element.h"
#include "third_party/blink/renderer/core/script/classic_script.h"
#include "third_party/blink/renderer/modules/domicile/domicile_app_host.h"
#include "third_party/blink/renderer/platform/bindings/script_state.h"
#include "third_party/blink/renderer/platform/bindings/v8_binding.h"
#include "third_party/blink/renderer/platform/heap/persistent.h"
#include "third_party/blink/renderer/platform/wtf/functional.h"

namespace blink {

namespace {

// The meta element an app's document names its module in. See
// ShellURLLoaderFactory::AppDocument, which writes it.
constexpr char kModuleMetaName[] = "domicile-app-module";

// What runs the app, as JavaScript: a function of the module's URL and the
// host. Reports a module that does not load, has no `main`, or whose `main`
// throws, on the page and the console, as DomicileShell's does for a shell.
constexpr char kRunApp[] = R"js((async (module, host) => {
  const say = (what) => {
    console.error("domicile: " + what);
    const said = document.createElement("pre");
    said.textContent = "domicile: " + what;
    said.setAttribute("style", "position:fixed;inset:0;margin:0;padding:16px;" +
      "overflow:auto;white-space:pre-wrap;font:13px/1.5 monospace;" +
      "background:#2b0b0b;color:#ffd7d7;z-index:2147483647");
    document.body.append(said);
  };
  const app = await import(module).catch((failure) => {
    say("the app module at " + module + " did not load: " + failure);
  });
  if (app === undefined) {
    return;
  }
  if (typeof app.main !== "function") {
    say("the app module at " + module + " has no main export. An app is " +
      "a module whose main export is a function, which Domicile calls with " +
      "the element to draw in and the host.");
    return;
  }
  try {
    await app.main(document.body, host);
  } catch (failure) {
    say("the app's main threw: " + failure);
  }
}))js";

// The document finished parsing.
class DocumentParsed final : public NativeEventListener {
 public:
  explicit DocumentParsed(base::RepeatingClosure run) : run_(std::move(run)) {}

  void Invoke(ExecutionContext*, Event*) override { run_.Run(); }

 private:
  const base::RepeatingClosure run_;
};

// The module the document names, resolved against it, or an empty URL for a
// document that names none.
KURL ModuleOf(Document& document) {
  for (HTMLMetaElement& meta :
       Traversal<HTMLMetaElement>::DescendantsOf(document)) {
    if (meta.GetName() == kModuleMetaName) {
      return document.CompleteURL(meta.Content());
    }
  }
  return KURL();
}

}  // namespace

// static
const char DomicileApp::kSupplementName[] = "DomicileApp";

// static
void DomicileApp::Install(LocalDOMWindow& window) {
  const KURL& url = window.Url();
  // The browser binds the host's channel only for an app's origin in a window
  // pinned to it. This only decides whether there is a module to run.
  if (!url.ProtocolIs(domicile::kDomicileScheme) ||
      !url.Host().ToString().StartsWith(domicile::kDomicileAppHostPrefix)) {
    return;
  }
  if (Supplement<LocalDOMWindow>::From<DomicileApp>(window)) {
    return;
  }
  auto* app = MakeGarbageCollected<DomicileApp>(window);
  ProvideTo(window, app);
  app->parsed_listener_ = MakeGarbageCollected<DocumentParsed>(
      BindRepeating(&DomicileApp::Run, WrapWeakPersistent(app)));
  window.document()->addEventListener(event_type_names::kDOMContentLoaded,
                                      app->parsed_listener_.Get());
}

DomicileApp::DomicileApp(LocalDOMWindow& window)
    : Supplement<LocalDOMWindow>(window) {}

void DomicileApp::Run() {
  LocalDOMWindow* window = GetSupplementable();
  Document* document = window->document();
  document->removeEventListener(event_type_names::kDOMContentLoaded,
                                parsed_listener_.Get(), /*use_capture=*/false);
  const KURL module = ModuleOf(*document);
  if (!module.IsValid() || !window->GetFrame()) {
    return;
  }

  ScriptState* script_state = ToScriptStateForMainWorld(window->GetFrame());
  if (!script_state) {
    return;
  }
  ScriptState::Scope scope(script_state);
  v8::Isolate* isolate = script_state->GetIsolate();

  // The document's own URL as the script's, so `import()` resolves against
  // the app's root.
  v8::Local<v8::Value> run =
      ClassicScript::Create(kRunApp, window->Url(), window->Url(),
                            ScriptFetchOptions())
          ->RunScriptAndReturnValue(window)
          .GetSuccessValueOrEmpty();
  if (run.IsEmpty() || !run->IsFunction()) {
    return;
  }

  host_ = MakeGarbageCollected<DomicileAppHost>(*window);
  v8::Local<v8::Value> arguments[] = {
      V8String(isolate, module.GetString()),
      ToV8Traits<DomicileAppHost>::ToV8(script_state, host_.Get()),
  };
  std::ignore = V8ScriptRunner::CallFunction(
      run.As<v8::Function>(), window, v8::Undefined(isolate),
      std::size(arguments), arguments, isolate);
}

void DomicileApp::Trace(Visitor* visitor) const {
  visitor->Trace(parsed_listener_);
  visitor->Trace(host_);
  Supplement<LocalDOMWindow>::Trace(visitor);
}

}  // namespace blink
