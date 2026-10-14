// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shell_window_wait.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/location.h"
#include "base/task/sequenced_task_runner.h"

namespace domicile {
namespace {

// How often an opening window is looked at again. A first page commits within
// a few hundred milliseconds, so this adds little to the wait.
constexpr base::TimeDelta kLookEvery = base::Milliseconds(50);

void LookUntil(LookForTheShellWindow look,
               base::TimeTicks deadline,
               ShellWindowReady ready) {
  switch (look.Run()) {
    case ShellWindowState::kShowingAPage:
      std::move(ready).Run(true);
      return;
    case ShellWindowState::kAbsent:
      std::move(ready).Run(false);
      return;
    case ShellWindowState::kOpening:
      if (base::TimeTicks::Now() >= deadline) {
        std::move(ready).Run(false);
        return;
      }
      base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
          FROM_HERE,
          base::BindOnce(&LookUntil, std::move(look), deadline,
                         std::move(ready)),
          kLookEvery);
      return;
  }
}

}  // namespace

void WhenTheShellWindowHasAPage(LookForTheShellWindow look,
                                base::TimeDelta patience,
                                ShellWindowReady ready) {
  LookUntil(std::move(look), base::TimeTicks::Now() + patience,
            std::move(ready));
}

}  // namespace domicile
