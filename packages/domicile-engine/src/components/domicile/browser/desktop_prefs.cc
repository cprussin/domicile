// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desktop_prefs.h"

#include "components/autofill/core/common/autofill_prefs.h"
#include "components/password_manager/core/common/password_manager_pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/translate/core/browser/translate_pref_names.h"

namespace domicile {

void TurnOffBrowserOffers(PrefService& prefs) {
  prefs.SetBoolean(password_manager::prefs::kCredentialsEnableService, false);
  prefs.SetBoolean(password_manager::prefs::kCredentialsEnableAutosignin,
                   false);
  prefs.SetBoolean(autofill::prefs::kAutofillProfileEnabled, false);
  prefs.SetBoolean(autofill::prefs::kAutofillCreditCardEnabled, false);
  prefs.SetBoolean(translate::prefs::kOfferTranslateEnabled, false);
}

}  // namespace domicile
