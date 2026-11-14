// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_RENDERER_ELECTRON_PRELOAD_H_
#define COMPONENTS_DOMICILE_RENDERER_ELECTRON_PRELOAD_H_

#include <cstdint>
#include <optional>
#include <string>

#include "base/memory/weak_ptr.h"
#include "components/domicile/mojom/electron_frame.mojom.h"
#include "content/public/renderer/render_frame_observer.h"
#include "content/public/renderer/render_frame_observer_tracker.h"
#include "mojo/public/cpp/bindings/associated_receiver.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "mojo/public/cpp/bindings/pending_associated_remote.h"
#include "v8/include/v8-forward.h"
#include "v8/include/v8-persistent-handle.h"

namespace domicile {

// An Electron app window's preload, in the renderer. The browser sends the
// preload before each navigation commits; this runs it in an isolated world
// when the new document's element is made, before any of the page's scripts,
// with `require("electron")` giving it contextBridge and ipcRenderer. See
// docs/architecture/ELECTRON-APPS.md.
//
// Every main frame has one; only those the browser sends a preload to do
// anything.
class ElectronPreload final
    : public content::RenderFrameObserver,
      public content::RenderFrameObserverTracker<ElectronPreload>,
      public mojom::ElectronFrame {
 public:
  // Gives `frame` one when it is a main frame. The frame owns it.
  static void Attach(content::RenderFrame* frame);

  ElectronPreload(const ElectronPreload&) = delete;
  ElectronPreload& operator=(const ElectronPreload&) = delete;
  ~ElectronPreload() override;

  // content::RenderFrameObserver:
  void ReadyToCommitNavigation(
      blink::WebDocumentLoader* document_loader) override;
  void DidCreateDocumentElement() override;
  void OnDestruct() override;

  // mojom::ElectronFrame:
  void Preload(
      const std::string& source,
      mojo::PendingAssociatedRemote<mojom::ElectronFrameHost> host) override;
  void Deliver(const std::string& channel,
               const std::string& args_json) override;

 private:
  struct Next {
    std::string source;
    mojo::PendingAssociatedRemote<mojom::ElectronFrameHost> host;
  };

  explicit ElectronPreload(content::RenderFrame* frame);

  void Bind(mojo::PendingAssociatedReceiver<mojom::ElectronFrame> receiver);
  void Run(const std::string& source);
  // Calls `function`, one of the bootstrap's, in the preload's world.
  void Call(const v8::Global<v8::Function>& function,
            int argc,
            v8::Local<v8::Value> argv[]);
  void Answered(uint64_t document,
                double id,
                bool ok,
                const std::string& answer);

  // The preload's natives, which the bootstrap wraps.
  static ElectronPreload* Of(v8::Isolate* isolate);
  static void Send(const v8::FunctionCallbackInfo<v8::Value>& info);
  static void Invoke(const v8::FunctionCallbackInfo<v8::Value>& info);
  static void Expose(const v8::FunctionCallbackInfo<v8::Value>& info);

  mojo::AssociatedReceiver<mojom::ElectronFrame> receiver_{this};
  // The preload for the navigation about to commit.
  std::optional<Next> next_;
  // The committed document's preload, until it runs.
  std::optional<std::string> to_run_;
  // Counts documents, so an answer for one that went is dropped.
  uint64_t document_ = 0;
  mojo::AssociatedRemote<mojom::ElectronFrameHost> host_;
  // The bootstrap's: what the app sends, and invoke's answers.
  v8::Global<v8::Function> deliver_;
  v8::Global<v8::Function> settle_;
  base::WeakPtrFactory<ElectronPreload> weak_factory_{this};
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_RENDERER_ELECTRON_PRELOAD_H_
