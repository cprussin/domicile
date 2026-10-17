// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desktop_prefs.h"

#include "components/autofill/core/common/autofill_prefs.h"
#include "components/password_manager/core/common/password_manager_pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/translate/core/browser/translate_pref_names.h"

namespace domicile {
namespace {

// From chrome/common/pref_names.h, which a component cannot include.
constexpr char kHttpsOnlyModeEnabled[] = "https_only_mode_enabled";
constexpr char kHttpsFirstBalancedMode[] = "https_first_balanced_mode_enabled";
constexpr char kHttpsFirstModeIncognito[] =
    "https_first_mode_incognito_enabled";

}  // namespace

void TurnOffBrowserOffers(PrefService& prefs) {
  prefs.SetBoolean(password_manager::prefs::kCredentialsEnableService, false);
  prefs.SetBoolean(password_manager::prefs::kCredentialsEnableAutosignin,
                   false);
  prefs.SetBoolean(autofill::prefs::kAutofillProfileEnabled, false);
  prefs.SetBoolean(autofill::prefs::kAutofillCreditCardEnabled, false);
  prefs.SetBoolean(translate::prefs::kOfferTranslateEnabled, false);
  // HTTPS-First Mode, Chrome's "Always use secure connections". Setting the
  // prefs also stops Chrome turning it on by itself. HTTPS Upgrades stay on:
  // an http address still tries https first and falls back without asking.
  prefs.SetBoolean(kHttpsOnlyModeEnabled, false);
  prefs.SetBoolean(kHttpsFirstBalancedMode, false);
  prefs.SetBoolean(kHttpsFirstModeIncognito, false);
}

}  // namespace domicile
