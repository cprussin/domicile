// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desktop_prefs.h"

#include "components/autofill/core/common/autofill_prefs.h"
#include "components/password_manager/core/common/password_manager_pref_names.h"
#include "components/prefs/testing_pref_service.h"
#include "components/translate/core/browser/translate_pref_names.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// Every pref Chrome registers on, as a fresh profile has them.
class DesktopPrefsTest : public testing::Test {
 protected:
  DesktopPrefsTest() {
    for (const char* name : kOffers) {
      prefs_.registry()->RegisterBooleanPref(name, true);
    }
  }

  static constexpr const char* kOffers[] = {
      password_manager::prefs::kCredentialsEnableService,
      password_manager::prefs::kCredentialsEnableAutosignin,
      autofill::prefs::kAutofillProfileEnabled,
      autofill::prefs::kAutofillCreditCardEnabled,
      translate::prefs::kOfferTranslateEnabled,
  };

  TestingPrefServiceSimple prefs_;
};

TEST_F(DesktopPrefsTest, TheBrowserOffersNothing) {
  TurnOffBrowserOffers(prefs_);
  for (const char* name : kOffers) {
    EXPECT_FALSE(prefs_.GetBoolean(name)) << name;
  }
}

}  // namespace
}  // namespace domicile
