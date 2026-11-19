// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_spellcheck.h"

#include <optional>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/task/bind_post_task.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profile_manager_observer.h"
#include "chrome/browser/spellchecker/spellcheck_custom_dictionary.h"
#include "chrome/browser/spellchecker/spellcheck_factory.h"
#include "chrome/browser/spellchecker/spellcheck_service.h"
#include "components/domicile/browser/control_channel.h"
#include "components/domicile/browser/spellcheck_settings.h"
#include "components/domicile/browser/web_view_guest.h"
#include "content/public/browser/browser_thread.h"

namespace domicile {
namespace {

// The desk's spell checking, as the compositor last said, for every profile
// and each one loaded later. Until it says, profiles keep the prefs they
// saved.
class DeskSpellcheck : public ProfileManagerObserver {
 public:
  DeskSpellcheck() {
    observation_.Observe(g_browser_process->profile_manager());
  }

  void Take(const SpellcheckSettings& settings) {
    settings_ = settings;
    for (Profile* profile :
         g_browser_process->profile_manager()->GetLoadedProfiles()) {
      ApplySpellcheck(*profile->GetPrefs(), settings);
    }
  }

  // ProfileManagerObserver:
  void OnProfileAdded(Profile* profile) override {
    if (settings_) {
      ApplySpellcheck(*profile->GetPrefs(), *settings_);
    }
  }

  void OnProfileManagerDestroying() override { observation_.Reset(); }

 private:
  std::optional<SpellcheckSettings> settings_;
  base::ScopedObservation<ProfileManager, ProfileManagerObserver>
      observation_{this};
};

DeskSpellcheck& Desk() {
  static base::NoDestructor<DeskSpellcheck> desk;
  return *desk;
}

}  // namespace

void StartSpellcheck() {
  // Created here, on the UI thread, before any channel can call the sink.
  Desk();
  SetSpellcheckSink(base::BindPostTask(
      content::GetUIThreadTaskRunner({}),
      base::BindRepeating([](const SpellcheckSettings& settings) {
        Desk().Take(settings);
      })));
  WebViewGuest::SetAddToDictionary(base::BindRepeating(&AddToDictionary));
}

void AddToDictionary(content::BrowserContext& context,
                     const std::string& word) {
  // A guest's menu offers a word only while its profile checks spelling.
  SpellcheckService* spellcheck =
      SpellcheckServiceFactory::GetForContext(&context);
  CHECK(spellcheck);
  spellcheck->GetCustomDictionary()->AddWord(word);
}

}  // namespace domicile
