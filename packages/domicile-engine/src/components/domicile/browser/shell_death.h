// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SHELL_DEATH_H_
#define COMPONENTS_DOMICILE_BROWSER_SHELL_DEATH_H_

#include <string>

#include "base/process/kill.h"
#include "url/gurl.h"

namespace domicile {

// Whether `page` is the shell's own page: any path on domicile://shell.
bool IsTheShellsPage(const GURL& page);

// The line the engine dies with when the shell at `page` loses its renderer:
// that this is a bug in Domicile, and why the renderer went.
std::string ShellDeathMessage(const GURL& page,
                              base::TerminationStatus status,
                              int exit_code);

// Ends the engine with ShellDeathMessage if `page` is the shell's. The
// shell's renderer goes only through a bug in Domicile, so the engine fails
// loudly rather than cover for it; the binary's supervisor starts a new one.
// Any other page returns, to Chrome's sad tab or the <webview>'s report.
// SadTabHelper calls it (patch 0124).
void DieIfTheShellDied(const GURL& page,
                       base::TerminationStatus status,
                       int exit_code);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SHELL_DEATH_H_
