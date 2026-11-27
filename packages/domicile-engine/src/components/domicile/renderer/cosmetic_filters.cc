// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/renderer/cosmetic_filters.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/time/time.h"
#include "components/domicile/renderer/cosmetic_stylesheet.h"
#include "content/public/renderer/render_frame.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/web/web_css_origin.h"
#include "third_party/blink/public/web/web_document.h"
#include "third_party/blink/public/web/web_element.h"
#include "third_party/blink/public/web/web_local_frame.h"
#include "third_party/blink/public/web/web_script_source.h"

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
bool CosmeticFilters::RunAtDocumentStart(content::RenderFrame* frame) {
  CosmeticFilters* self = Get(frame);
  if (!self || self->pending_script_.empty()) {
    return true;
  }
  std::string script = std::move(self->pending_script_);
  self->pending_script_.clear();
  // A scriptlet is a page script, and may end the frame, this with it.
  base::WeakPtr<CosmeticFilters> alive = self->weak_factory_.GetWeakPtr();
  self->Run(script);
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
    mojo::PendingAssociatedRemote<mojom::CosmeticFiltersHost> host) {
  Next next;
  next.selectors = selectors;
  next.script = script;
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
  host_.reset();
  asked_.clear();
  again_.Stop();
  gathers_left_ = 0;
  if (next_.has_value()) {
    pending_ = std::move(next_->selectors);
    pending_script_ = std::move(next_->script);
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
