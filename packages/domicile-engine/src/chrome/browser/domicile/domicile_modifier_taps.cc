// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_modifier_taps.h"

#include "base/no_destructor.h"
#include "components/domicile/browser/desk_modifier_taps.h"
#include "content/public/browser/browser_thread.h"
#include "ui/aura/env.h"
#include "ui/events/event.h"
#include "ui/events/event_observer.h"

namespace domicile {
namespace {

// Every key aura dispatches, wherever it is going: the shell page, a
// `<webview>` guest or a native window. An observer only watches, so the key
// still reaches whoever has the keyboard.
class TapListener : public ui::EventObserver {
 public:
  TapListener() {
    aura::Env* env = aura::Env::GetInstance();
    env->AddEventObserver(this, env, DeskModifierTaps::Types());
  }

  // ui::EventObserver:
  void OnEvent(const ui::Event& event) override {
    DeskModifierTaps::Get().Heard(event);
  }
};

}  // namespace

void StartModifierTaps() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  // Lives for the life of the browser.
  static base::NoDestructor<TapListener> listener;
}

}  // namespace domicile
