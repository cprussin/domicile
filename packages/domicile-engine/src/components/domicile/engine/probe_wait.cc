// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/probe_wait.h"

#include "base/location.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/timer/timer.h"

namespace domicile {

bool RunUntilQuit(base::RunLoop& loop, base::TimeDelta patience) {
  // Destroyed on return, so a wait that was answered leaves no quit behind.
  base::OneShotTimer timer;
  timer.Start(FROM_HERE, patience, loop.QuitClosure());
  loop.Run();
  return timer.IsRunning();
}

std::string NeverAnswered(std::string_view request,
                          uint64_t number,
                          base::TimeDelta patience) {
  return base::StrCat({"domicile: the browser never answered ", request, " ",
                       base::NumberToString(number), " after ",
                       base::NumberToString(patience.InSeconds()),
                       "s, so the producer stops here rather than wait "
                       "forever"});
}

}  // namespace domicile
