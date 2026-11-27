// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_RENDERER_COSMETIC_FILTERS_H_
#define COMPONENTS_DOMICILE_RENDERER_COSMETIC_FILTERS_H_

#include <cstdint>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"
#include "components/domicile/mojom/cosmetic_filters.mojom.h"
#include "content/public/renderer/render_frame_observer.h"
#include "content/public/renderer/render_frame_observer_tracker.h"
#include "mojo/public/cpp/bindings/associated_receiver.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "mojo/public/cpp/bindings/pending_associated_remote.h"
#include "v8/include/v8-forward.h"

namespace domicile {

// A frame's cosmetic filters, in the renderer: hides what the lists name by
// its elements. The browser sends what to hide before each navigation
// commits (CosmeticFiltering, in domicile_ad_blocking.cc); this puts it in
// the new document as a user stylesheet, so it applies from the first style
// and the page can't override it, and runs the scriptlets the site's
// `##+js(...)` rules name in its main world at document start, before any
// script of its own and before extensions' `document_start` scripts. Its
// procedural filters (`:has-text()`, `:upward()`), which CSS can't say, are
// applied as the page changes by Brave's content_cosmetic.ts, unchanged, in
// an isolated world of their own, so the page can't see or stop it. See
// docs/architecture/AD-BLOCKING.md.
//
// The lists' generic rules name classes and ids (`##.ad-banner`), tens of
// thousands of them, so the browser sends only the site's own and the
// generic ones that are not a bare class or id. This then gathers the
// document's classes and ids once it has parsed, once it has loaded, and
// every few seconds for a while after, as pages add ads late, and asks the
// browser which of the generic rules hide them.
//
// Every frame has one; only those the browser sends a Hide to do anything.
class CosmeticFilters final
    : public content::RenderFrameObserver,
      public content::RenderFrameObserverTracker<CosmeticFilters>,
      public mojom::CosmeticFilters {
 public:
  // Gives `frame` one. The frame owns it.
  static void Attach(content::RenderFrame* frame);

  // Runs the scriptlets the browser sent for `frame`'s new document, if it
  // sent any, then starts its procedural filters in the isolated world
  // `procedural_world`. Blink forbids script while it tells observers the
  // document's element exists (DidCreateDocumentElement), so
  // ContentRendererClient::RunScriptsAtDocumentStart calls this, just after.
  // A scriptlet is a page script and may end the frame: false when it did,
  // and `frame` must not be used again.
  [[nodiscard]] static bool RunAtDocumentStart(content::RenderFrame* frame,
                                               int32_t procedural_world);

  CosmeticFilters(const CosmeticFilters&) = delete;
  CosmeticFilters& operator=(const CosmeticFilters&) = delete;
  ~CosmeticFilters() override;

  // content::RenderFrameObserver:
  void ReadyToCommitNavigation(
      blink::WebDocumentLoader* document_loader) override;
  void DidCreateDocumentElement() override;
  void DidCreateScriptContext(v8::Local<v8::Context> context,
                              int32_t world_id) override;
  void DidDispatchDOMContentLoadedEvent() override;
  void DidFinishLoad() override;
  void OnDestruct() override;

  // mojom::CosmeticFilters:
  void Hide(
      const std::vector<std::string>& selectors,
      const std::string& script,
      const std::vector<std::string>& procedural_filters,
      mojo::PendingAssociatedRemote<mojom::CosmeticFiltersHost> host) override;

 private:
  explicit CosmeticFilters(content::RenderFrame* frame);

  void Bind(mojo::PendingAssociatedReceiver<mojom::CosmeticFilters> receiver);

  // What a Hide sent for the document about to commit.
  struct Next {
    Next();
    Next(Next&&);
    Next& operator=(Next&&);
    ~Next();

    std::vector<std::string> selectors;
    std::string script;
    std::vector<std::string> procedural_filters;
    mojo::PendingAssociatedRemote<mojom::CosmeticFiltersHost> host;
  };

  // Inserts `selectors` into the document as a user stylesheet.
  void Insert(const std::vector<std::string>& selectors);
  // Runs the scriptlets' `script` in the document's main world.
  void Run(const std::string& script);
  // Starts content_cosmetic.ts on `filters` in the isolated world `world`.
  void RunProcedural(const std::vector<std::string>& filters, int32_t world);
  // content_cosmetic.ts's `cf_worker`, in its world: hides by `css`, as a
  // user stylesheet, and says whether `url` is the page's own site.
  void InjectStylesheet(const std::string& css);
  bool IsFirstPartyUrl(const std::string& url) const;
  // Asks the host about the document's classes and ids it has not asked
  // about yet.
  void Gather();
  void Hidden(int document, const std::vector<std::string>& selectors);

  mojo::AssociatedReceiver<mojom::CosmeticFilters> receiver_{this};
  std::optional<Next> next_;
  // The current document's: its selectors until its element exists, its
  // scriptlets and procedural filters until document start, and its host.
  std::vector<std::string> pending_;
  std::string pending_script_;
  std::vector<std::string> pending_procedural_;
  // The isolated world the procedural filters run in, once they have, so
  // its new contexts get `cf_worker`.
  std::optional<int32_t> procedural_world_;
  mojo::AssociatedRemote<mojom::CosmeticFiltersHost> host_;
  // The classes and ids already asked about, as `.name` and `#name`.
  std::set<std::string> asked_;
  // Counts documents, so an answer for an older one is dropped.
  int document_ = 0;
  // Gathers again every few seconds after the load, a few times.
  base::RepeatingTimer again_;
  int gathers_left_ = 0;
  base::WeakPtrFactory<CosmeticFilters> weak_factory_{this};
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_RENDERER_COSMETIC_FILTERS_H_
