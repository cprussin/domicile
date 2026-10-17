// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_printing.h"

#include "base/logging.h"
#include "chrome/browser/printing/print_view_manager_common.h"
#include "chrome/browser/printing/printing_init.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/web_contents.h"

namespace domicile {

void PrintWithTheSystemDialog(Profile& profile) {
  profile.GetPrefs()->SetBoolean(prefs::kPrintPreviewDisabled, true);
}

void AttachPrinting(content::WebContents& guest) {
  printing::InitializePrintingForWebContents(&guest);
}

void PrintPage(content::WebContents& guest) {
  // guard-webview-print.sh reads this to tell "never asked" from "asked and
  // the page never printed".
  LOG(INFO) << "domicile: printing a <webview>'s page with the system dialog.";
  printing::StartBasicPrint(&guest);
}

}  // namespace domicile
