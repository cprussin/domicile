// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/renderer/cosmetic_filters.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/strings/stringprintf.h"
#include "base/time/time.h"
#include "base/values.h"
#include "components/domicile/renderer/cosmetic_stylesheet.h"
#include "components/domicile/renderer/procedural_filters/procedural_filters_script.h"
#include "content/public/renderer/render_frame.h"
#include "gin/converter.h"
#include "gin/function_template.h"
#include "net/base/registry_controlled_domains/registry_controlled_domain.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/platform/scheduler/web_agent_group_scheduler.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/web/web_css_origin.h"
#include "third_party/blink/public/web/web_document.h"
#include "third_party/blink/public/web/web_element.h"
#include "third_party/blink/public/web/web_local_frame.h"
#include "third_party/blink/public/web/web_script_source.h"
#include "url/gurl.h"
#include "v8/include/v8-context.h"
#include "v8/include/v8-function.h"
#include "v8/include/v8-local-handle.h"
#include "v8/include/v8-object.h"

namespace domicile {

namespace {

// How often, and how many times, the document's classes and ids are
// gathered again after it loaded: pages add ads late, and Blink tells a
// RenderFrameObserver of no change to the DOM.
constexpr base::TimeDelta kGatherEvery = base::Seconds(2);
constexpr int kGathersAfterLoad = 15;

// At most this many new classes and ids per question, so a page with
// thousands of generated class names costs the browser one bounded lookup.
constexpr size_t kMostPerAsk = 2000;

// Brave's kCosmeticFilteringInitScript, set so content_cosmetic.ts does
// only the procedural filters: `generichide`, as the generic class and id
// rules are this class's, and `hide1pContent`, as a page hides the same in
// Standard and Strict, its own content too.
constexpr char kFlagsScript[] = R"((() => {
  window.content_cosmetic = window.content_cosmetic || {};
  const CC = window.content_cosmetic;
  CC.hide1pContent = true;
  CC.generichide = true;
})();)";

// Brave's kProceduralActionsScript: a filter that is one selector with a
// style becomes a stylesheet rule, and content_cosmetic.ts applies the rest.
constexpr char kProceduralScript[] = R"((() => {
  const CC = window.content_cosmetic;
  let stylesheet = '';
  CC.proceduralActionFilters = %s.map((f) => JSON.parse(f)).filter((f) => {
    if (f.selector.length === 1 && f.selector[0].type === 'css-selector' &&
        f.action && f.action.type === 'style') {
      stylesheet += f.selector[0].arg + '{' + f.action.arg + '}\n';
      return false;
    }
    return true;
  });
  CC.hasProceduralActions = CC.proceduralActionFilters.length > 0;
  if (stylesheet !== '') {
    cf_worker.injectStylesheet(stylesheet);
  }
})();)";

std::string Json(const std::vector<std::string>& strings) {
  base::ListValue list;
  for (const std::string& string : strings) {
    list.Append(string);
  }
  // A list of strings always writes.
  return base::WriteJson(list).value();
}

// Sets `object[name]` to a function that runs `callback`.
template <typename Signature>
void SetFunction(v8::Isolate* isolate,
                 v8::Local<v8::Context> context,
                 v8::Local<v8::Object> object,
                 std::string_view name,
                 base::RepeatingCallback<Signature> callback) {
  object
      ->Set(context, gin::StringToSymbol(isolate, name),
            gin::CreateFunctionTemplate(isolate, std::move(callback))
                ->GetFunction(context)
                .ToLocalChecked())
      .Check();
}

}  // namespace

CosmeticFilters::Next::Next() = default;
CosmeticFilters::Next::Next(Next&&) = default;
CosmeticFilters::Next& CosmeticFilters::Next::operator=(Next&&) = default;
CosmeticFilters::Next::~Next() = default;

// static
void CosmeticFilters::Attach(content::RenderFrame* frame) {
  new CosmeticFilters(frame);
}

// static
bool CosmeticFilters::RunAtDocumentStart(content::RenderFrame* frame,
                                         int32_t procedural_world) {
  CosmeticFilters* self = Get(frame);
  if (!self) {
    return true;
  }
  std::string script = std::move(self->pending_script_);
  self->pending_script_.clear();
  std::vector<std::string> procedural = std::move(self->pending_procedural_);
  self->pending_procedural_.clear();
  // A scriptlet is a page script, and may end the frame, this with it.
  base::WeakPtr<CosmeticFilters> alive = self->weak_factory_.GetWeakPtr();
  if (!script.empty()) {
    self->Run(script);
    if (!alive) {
      return false;
    }
  }
  if (!procedural.empty()) {
    self->RunProcedural(procedural, procedural_world);
  }
  return !!alive;
}

CosmeticFilters::CosmeticFilters(content::RenderFrame* frame)
    : content::RenderFrameObserver(frame),
      content::RenderFrameObserverTracker<CosmeticFilters>(frame) {
  frame->GetAssociatedInterfaceRegistry()
      ->AddInterface<mojom::CosmeticFilters>(base::BindRepeating(
          &CosmeticFilters::Bind, weak_factory_.GetWeakPtr()));
}

CosmeticFilters::~CosmeticFilters() = default;

void CosmeticFilters::Bind(
    mojo::PendingAssociatedReceiver<mojom::CosmeticFilters> receiver) {
  // The browser asks again for each navigation.
  receiver_.reset();
  receiver_.Bind(std::move(receiver));
}

void CosmeticFilters::Hide(
    const std::vector<std::string>& selectors,
    const std::string& script,
    const std::vector<std::string>& procedural_filters,
    mojo::PendingAssociatedRemote<mojom::CosmeticFiltersHost> host) {
  Next next;
  next.selectors = selectors;
  next.script = script;
  next.procedural_filters = procedural_filters;
  next.host = std::move(host);
  next_ = std::move(next);
}

void CosmeticFilters::ReadyToCommitNavigation(
    blink::WebDocumentLoader* document_loader) {
  // A new document: what the last one hid goes with it, and one the browser
  // sent nothing for (a page in a mode that hides nothing) hides nothing.
  ++document_;
  pending_.clear();
  pending_script_.clear();
  pending_procedural_.clear();
  host_.reset();
  asked_.clear();
  again_.Stop();
  gathers_left_ = 0;
  if (next_.has_value()) {
    pending_ = std::move(next_->selectors);
    pending_script_ = std::move(next_->script);
    pending_procedural_ = std::move(next_->procedural_filters);
    if (next_->host.is_valid()) {
      host_.Bind(std::move(next_->host));
    }
    next_.reset();
  }
}

void CosmeticFilters::DidCreateDocumentElement() {
  // Blink runs no script here: the scriptlets wait for RunAtDocumentStart,
  // which comes next.
  if (!pending_.empty()) {
    Insert(pending_);
    pending_.clear();
  }
}

void CosmeticFilters::DidCreateScriptContext(v8::Local<v8::Context> context,
                                             int32_t world_id) {
  // Only the procedural filters' world gets `cf_worker`: never the page's.
  if (procedural_world_ != world_id) {
    return;
  }
  v8::Isolate* isolate =
      render_frame()->GetWebFrame()->GetAgentGroupScheduler()->Isolate();
  v8::HandleScope handle_scope(isolate);
  v8::Context::Scope context_scope(context);
  v8::Local<v8::Object> worker = v8::Object::New(isolate);
  // The world goes with the frame, and this with it, but a script can hold a
  // function past either: then it does nothing.
  base::WeakPtr<CosmeticFilters> weak = weak_factory_.GetWeakPtr();
  SetFunction(isolate, context, worker, "injectStylesheet",
              base::BindRepeating(&CosmeticFilters::InjectStylesheet, weak));
  SetFunction(
      isolate, context, worker, "isFirstPartyUrl",
      base::BindRepeating(
          [](base::WeakPtr<CosmeticFilters> self, const std::string& url) {
            return self && self->IsFirstPartyUrl(url);
          },
          weak));
  // Asked only without `generichide`, which kFlagsScript sets.
  SetFunction(isolate, context, worker, "hiddenClassIdSelectors",
              base::BindRepeating([](const std::string&) {}));
  context->Global()
      ->Set(context, gin::StringToSymbol(isolate, "cf_worker"), worker)
      .Check();
}

void CosmeticFilters::DidDispatchDOMContentLoadedEvent() {
  Gather();
}

void CosmeticFilters::DidFinishLoad() {
  Gather();
  if (!host_.is_bound()) {
    return;
  }
  gathers_left_ = kGathersAfterLoad;
  again_.Start(FROM_HERE, kGatherEvery,
               base::BindRepeating(
                   [](CosmeticFilters* self) {
                     self->Gather();
                     if (--self->gathers_left_ <= 0) {
                       self->again_.Stop();
                     }
                   },
                   base::Unretained(this)));
}

void CosmeticFilters::OnDestruct() {
  delete this;
}

void CosmeticFilters::Insert(const std::vector<std::string>& selectors) {
  const std::string sheet = CosmeticStylesheetOf(selectors);
  if (sheet.empty()) {
    return;
  }
  // A user stylesheet, which beats the page's own `!important` rules.
  render_frame()->GetWebFrame()->GetDocument().InsertStyleSheet(
      blink::WebString::FromUtf8(sheet), nullptr, blink::WebCssOrigin::kUser);
}

void CosmeticFilters::Run(const std::string& script) {
  // In a function of its own, so what the scriptlets define stays theirs.
  // A scriptlet that throws stops only itself: adblock-rust wraps each.
  // uBlock Origin's read `scriptletGlobals`, which it defines around them
  // with the options its logger sets; none here, as Brave runs them.
  render_frame()->GetWebFrame()->ExecuteScript(
      blink::WebScriptSource(blink::WebString::FromUtf8(
          "(function() {\nconst scriptletGlobals = {};\n" + script +
          "\n})();")));
}

void CosmeticFilters::RunProcedural(const std::vector<std::string>& filters,
                                    int32_t world) {
  procedural_world_ = world;
  blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
  const auto run = [&](const std::string& script) {
    frame->ExecuteScriptInIsolatedWorld(
        world, blink::WebScriptSource(blink::WebString::FromUtf8(script)),
        blink::BackForwardCacheAware::kAllow);
  };
  // The first script in the world makes its context, which gets cf_worker.
  run(kFlagsScript);
  run(base::StringPrintf(kProceduralScript, Json(filters).c_str()));
  run(kProceduralFiltersScript);
}

void CosmeticFilters::InjectStylesheet(const std::string& css) {
  if (css.empty()) {
    return;
  }
  // A user stylesheet, which beats the page's own `!important` rules.
  render_frame()->GetWebFrame()->GetDocument().InsertStyleSheet(
      blink::WebString::FromUtf8(css), nullptr, blink::WebCssOrigin::kUser);
}

bool CosmeticFilters::IsFirstPartyUrl(const std::string& url) const {
  return net::registry_controlled_domains::SameDomainOrHost(
      GURL(url), GURL(render_frame()->GetWebFrame()->GetDocument().Url()),
      net::registry_controlled_domains::INCLUDE_PRIVATE_REGISTRIES);
}

void CosmeticFilters::Gather() {
  if (!host_.is_bound()) {
    return;
  }
  blink::WebDocument document = render_frame()->GetWebFrame()->GetDocument();
  if (document.IsNull()) {
    return;
  }
  std::vector<std::string> classes;
  std::vector<std::string> ids;
  const auto add = [&](std::string name, char kind,
                       std::vector<std::string>& to) {
    if (classes.size() + ids.size() >= kMostPerAsk) {
      return;
    }
    if (asked_.insert(std::string(1, kind) + name).second) {
      to.push_back(std::move(name));
    }
  };
  for (const blink::WebElement& element :
       document.QuerySelectorAll(blink::WebString::FromAscii("[id],[class]"))) {
    const std::string id = element.GetIdAttribute().Utf8();
    if (!id.empty()) {
      add(id, '#', ids);
    }
    const blink::WebString classes_attribute =
        element.GetAttribute(blink::WebString::FromAscii("class"));
    if (!classes_attribute.IsNull()) {
      for (std::string& name : ClassesOf(classes_attribute.Utf8())) {
        add(std::move(name), '.', classes);
      }
    }
  }
  if (classes.empty() && ids.empty()) {
    return;
  }
  host_->HiddenSelectors(
      std::move(classes), std::move(ids),
      base::BindOnce(&CosmeticFilters::Hidden, weak_factory_.GetWeakPtr(),
                     document_));
}

void CosmeticFilters::Hidden(int document,
                             const std::vector<std::string>& selectors) {
  if (document != document_ || selectors.empty()) {
    return;
  }
  Insert(selectors);
}

}  // namespace domicile
