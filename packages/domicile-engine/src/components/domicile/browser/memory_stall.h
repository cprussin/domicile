// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_MEMORY_STALL_H_
#define COMPONENTS_DOMICILE_BROWSER_MEMORY_STALL_H_

#include <optional>
#include <string_view>

namespace domicile {

// The share of the last ten seconds with a task waiting on memory, from the
// text of /proc/pressure/memory. Nothing for text that names none.
std::optional<double> StalledPercent(std::string_view pressure);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_MEMORY_STALL_H_
