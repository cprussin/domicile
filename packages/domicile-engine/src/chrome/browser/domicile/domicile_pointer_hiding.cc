// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_pointer_hiding.h"

#include <string>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/task/bind_post_task.h"
#include "chrome/browser/domicile/domicile_browser_windows.h"
#include "components/domicile/browser/desk_gestures.h"
#include "components/domicile/browser/desk_pointer_hiding.h"
#include "components/domicile/browser/pointer_hiding.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/web_contents.h"
#include "ui/aura/client/cursor_client.h"
#include "ui/aura/env.h"
#include "ui/aura/window.h"
#include "ui/events/event.h"
#include "ui/events/event_observer.h"
#include "ui/gfx/native_ui_types.h"

namespace domicile {
namespace {

// The desk's pointer, through the cursor client of the shell's root window.
// Every root window shares one cursor manager, so hiding it there hides it on
// every monitor, in screen casts, and on the host when nested.
class AuraPointer : public PointerHiding::Pointer {
 public:
  // PointerHiding::Pointer:
  void Hide() override {
    if (aura::client::CursorClient* client = Client()) {
      client->HideCursor();
    }
  }
  void Show() override {
    if (aura::client::CursorClient* client = Client()) {
      client->ShowCursor();
    }
  }

 private:
  // The cursor client, or null while there is no shell page to have one.
  static aura::client::CursorClient* Client() {
    content::WebContents* shell = DeskShellContents();
    if (shell == nullptr) {
      return nullptr;
    }
    gfx::NativeView view = shell->GetNativeView();
    if (view == gfx::NativeView() || view->GetRootWindow() == nullptr) {
      return nullptr;
    }
    return aura::client::GetCursorClient(view->GetRootWindow());
  }
};

class PointerHider : public ui::EventObserver {
 public:
  PointerHider() {
    aura::Env* env = aura::Env::GetInstance();
    env->AddEventObserver(this, env, PointerHiding::Types());
    // Unretained: this lives for the life of the browser.
    const auto on_ui = content::GetUIThreadTaskRunner({});
    DeskPointerHiding::Get().AddListener(base::BindPostTask(
        on_ui,
        base::BindRepeating(&PointerHider::Configure, base::Unretained(this))));
    DeskGestures::Get().ListenForTouchpad(base::BindPostTask(
        on_ui, base::BindRepeating(&PointerHiding::Touched,
                                   base::Unretained(&hiding_))));
    // A shell page's channel may have set them before this listened.
    Configure(DeskPointerHiding::Get().Now());
  }

  // ui::EventObserver:
  void OnEvent(const ui::Event& event) override { hiding_.Heard(event); }

 private:
  void Configure(const PointerHidingSettings& settings) {
    LOG(INFO) << "domicile: the desk hides the pointer after "
              << (settings.after
                      ? base::NumberToString(settings.after->InMilliseconds()) +
                            " ms"
                      : std::string("no pause"))
              << (settings.when_typing ? " and while typing" : "");
    hiding_.Configure(settings);
  }

  AuraPointer pointer_;
  PointerHiding hiding_{pointer_};
};

}  // namespace

void StartPointerHiding() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  // Lives for the life of the browser.
  static base::NoDestructor<PointerHider> hider;
}

}  // namespace domicile
