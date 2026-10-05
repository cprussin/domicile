// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_shell.h"

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
#include "third_party/blink/renderer/modules/domicile/domicile_host.h"
#include "third_party/blink/renderer/platform/bindings/script_state.h"
#include "third_party/blink/renderer/platform/bindings/v8_binding.h"
#include "third_party/blink/renderer/platform/heap/persistent.h"
#include "third_party/blink/renderer/platform/wtf/functional.h"

namespace blink {

namespace {

// The meta element the shell document names its module in. See
// ShellURLLoaderFactory::ShellDocument, which writes it.
constexpr char kModuleMetaName[] = "domicile-shell-module";

// What runs the shell, as JavaScript: a function of the module's URL and the
// desktop, evaluated without binding it to any name -- see DomicileShell.
//
// AND IT REPORTS ITS OWN SHELL FAILING. A module that 404s, will not parse,
// throws on its first line, has no `Shell`, or whose `Shell` throws, would
// leave the window blank and every log silent: the engine served what it was
// asked for, the compositor only knows it is waiting, and the shell never ran
// to say anything. So each of those is said on the screen as well as on the
// console -- `--app` has no tab strip to open devtools from -- with
// `textContent` rather than markup, because the text has a filename and an
// exception message in it, both from outside.
//
// ONLY UNTIL `Shell` RETURNS. After that the page belongs to the shell, and a
// report painted over a working desktop would be worse than the blank window
// this exists to replace.
constexpr char kRunShell[] = R"js((async (module, desktop) => {
  const say = (what) => {
    console.error("domicile: " + what);
    const said = document.createElement("pre");
    said.textContent = "domicile: " + what;
    said.setAttribute("style", "position:fixed;inset:0;margin:0;padding:16px;" +
      "overflow:auto;white-space:pre-wrap;font:13px/1.5 monospace;" +
      "background:#2b0b0b;color:#ffd7d7;z-index:2147483647");
    document.body.append(said);
  };
  const shell = await import(module).catch((failure) => {
    say("the shell module at " + module + " did not load: " + failure +
      ". The engine serves it out of --domicile-shell-root under the name " +
      "--domicile-shell-module gave; a module that imports a file which is " +
      "not there, will not parse, or throws while it loads fails here too.");
  });
  if (shell === undefined) {
    return;
  }
  if (typeof shell.Shell !== "function") {
    say("the shell module at " + module + " has no Shell export. A shell is " +
      "a module whose Shell export is a function, which Domicile calls with " +
      "the element to draw in and the desktop.");
    return;
  }
  try {
    shell.Shell(document.body, desktop);
  } catch (failure) {
    say("the shell's Shell threw: " + failure);
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
const char DomicileShell::kSupplementName[] = "DomicileShell";

// static
void DomicileShell::Install(LocalDOMWindow& window) {
  const KURL& url = window.Url();
  if (!url.ProtocolIs(domicile::kDomicileScheme) ||
      url.Host() != StringView(domicile::kDomicileShellHost)) {
    return;
  }
  // The window object is cleared more than once for some documents; the
  // shell runs once.
  if (Supplement<LocalDOMWindow>::From<DomicileShell>(window)) {
    return;
  }
  auto* shell = MakeGarbageCollected<DomicileShell>(window);
  ProvideTo(window, shell);
  shell->parsed_listener_ = MakeGarbageCollected<DocumentParsed>(
      BindRepeating(&DomicileShell::Run, WrapWeakPersistent(shell)));
  window.document()->addEventListener(event_type_names::kDOMContentLoaded,
                                      shell->parsed_listener_.Get());
}

DomicileShell::DomicileShell(LocalDOMWindow& window)
    : Supplement<LocalDOMWindow>(window) {}

void DomicileShell::Run() {
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

  // The document's own URL as the script's, so `import()` resolves and is
  // fetched as the shell document's own request -- which is what
  // ShellURLLoaderFactory answers.
  v8::Local<v8::Value> run =
      ClassicScript::Create(kRunShell, window->Url(), window->Url(),
                            ScriptFetchOptions())
          ->RunScriptAndReturnValue(window)
          .GetSuccessValueOrEmpty();
  if (run.IsEmpty() || !run->IsFunction()) {
    return;
  }

  // Kept here as well as in the shell's hands: the channel is the desktop's
  // for the life of the document, whether or not the shell holds on to it.
  desktop_ = MakeGarbageCollected<DomicileHost>(*window);
  // Before the shell runs, so the desktop's listeners come before its own.
  desktop_->RouteInput();
  v8::Local<v8::Value> arguments[] = {
      V8String(isolate, module.GetString()),
      ToV8Traits<DomicileHost>::ToV8(script_state, desktop_.Get()),
  };
  std::ignore = V8ScriptRunner::CallFunction(
      run.As<v8::Function>(), window, v8::Undefined(isolate),
      std::size(arguments), arguments, isolate);
}

void DomicileShell::Trace(Visitor* visitor) const {
  visitor->Trace(parsed_listener_);
  visitor->Trace(desktop_);
  Supplement<LocalDOMWindow>::Trace(visitor);
}

}  // namespace blink
