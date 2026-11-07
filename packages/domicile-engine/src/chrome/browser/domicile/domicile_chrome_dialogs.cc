// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_chrome_dialogs.h"

#include <string>

#include "base/command_line.h"
#include "base/strings/strcat.h"
#include "components/web_modal/web_contents_modal_dialog_manager.h"
#include "content/public/common/content_switches.h"

namespace domicile {
namespace {

// The Blink features a page loses: the APIs whose only UI is Chrome's.
// PaymentRequest is one too, but Blink takes it from WebPreferences, so
// patch 0183 turns it off in OverrideWebPreferences.
constexpr char kChromeSheetFeatures[] = "FedCm";

}  // namespace

void RefuseChromeDialogs() {
  web_modal::WebContentsModalDialogManager::RefuseEveryDialog();

  // Added to whatever the engine was started with, since a second copy of the
  // switch would replace the first. Content copies the browser's switch to
  // each renderer as it starts it.
  base::CommandLine& command_line = *base::CommandLine::ForCurrentProcess();
  const std::string given =
      command_line.GetSwitchValueASCII(switches::kDisableBlinkFeatures);
  command_line.AppendSwitchASCII(
      switches::kDisableBlinkFeatures,
      given.empty() ? std::string(kChromeSheetFeatures)
                    : base::StrCat({given, ",", kChromeSheetFeatures}));
}

}  // namespace domicile
