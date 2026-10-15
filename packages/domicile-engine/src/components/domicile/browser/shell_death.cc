// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shell_death.h"

#include <string>

#include "base/logging.h"
#include "base/process/kill.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "components/domicile/browser/render_process.h"
#include "components/domicile/common/domicile_scheme.h"
#include "url/gurl.h"

namespace domicile {

bool IsTheShellsPage(const GURL& page) {
  return page.SchemeIs(kDomicileScheme) && page.host() == kDomicileShellHost;
}

std::string ShellDeathMessage(const GURL& page,
                              base::TerminationStatus status,
                              int exit_code) {
  return base::StrCat(
      {"domicile: the Domicile shell's renderer died (",
       RenderProcessName(RenderProcessOf(status)), ", exit code ",
       base::NumberToString(exit_code), ") at ", page.spec(),
       ". This is a bug in Domicile; please report it with this log at "
       "https://github.com/cprussin/domicile/issues."});
}

void DieIfTheShellDied(const GURL& page,
                       base::TerminationStatus status,
                       int exit_code) {
  if (IsTheShellsPage(page)) {
    LOG(FATAL) << ShellDeathMessage(page, status, exit_code);
  }
}

}  // namespace domicile
