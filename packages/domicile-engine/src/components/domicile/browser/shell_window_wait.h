// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SHELL_WINDOW_WAIT_H_
#define COMPONENTS_DOMICILE_BROWSER_SHELL_WINDOW_WAIT_H_

#include "base/functional/callback.h"
#include "base/time/time.h"

namespace domicile {

// How far the shell's window is with its first page.
enum class ShellWindowState {
  // A window shows a domicile:// page, so a shell can be loaded into it.
  kShowingAPage,
  // A window is opening a domicile:// address and has not committed it yet.
  kOpening,
  // No window shows or is opening a domicile:// page.
  kAbsent,
};

using LookForTheShellWindow = base::RepeatingCallback<ShellWindowState()>;

// Runs once with whether the shell's window shows a page.
using ShellWindowReady = base::OnceCallback<void(bool has_a_page)>;

// Runs `ready` once the window `look` finds shows a page.
//
// The engine takes commands before its first page commits, so a `load_shell`,
// `run_app` or `open_url` can arrive while the window is still opening. Looks again on the current
// sequence while it is, and gives up after `patience`. Runs `ready` before
// returning when the window already shows a page or there is none.
void WhenTheShellWindowHasAPage(LookForTheShellWindow look,
                                base::TimeDelta patience,
                                ShellWindowReady ready);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SHELL_WINDOW_WAIT_H_
