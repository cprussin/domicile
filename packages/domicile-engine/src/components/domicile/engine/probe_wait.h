// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_PROBE_WAIT_H_
#define COMPONENTS_DOMICILE_ENGINE_PROBE_WAIT_H_

#include <cstdint>
#include <string>
#include <string_view>

#include "base/run_loop.h"
#include "base/time/time.h"

namespace domicile {

// Runs `loop` until it quits or `patience` passes. True if it quit.
//
// The spike probes quit their loop when the browser answers, so false means
// the browser never answered.
bool RunUntilQuit(base::RunLoop& loop, base::TimeDelta patience);

// Why the producer stops when the browser never answered probe `request`
// number `number` within `patience`.
std::string NeverAnswered(std::string_view request,
                          uint64_t number,
                          base::TimeDelta patience);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_ENGINE_PROBE_WAIT_H_
