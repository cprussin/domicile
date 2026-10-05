// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SYSTEM_CALL_H_
#define COMPONENTS_DOMICILE_BROWSER_SYSTEM_CALL_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace domicile {

// The shell's system calls, relayed between the page and the compositor
// without reading them. See docs/architecture/SYSTEM-ACCESS.md.
//
// The compositor checks every call, the lock included. The browser only makes
// sure a page's call stays a system call: the page writes the request, and
// this writes the line around it.

// The `system_request` line for the page's call `id`, or nothing when
// `request` is not a JSON object with a string `call`, or `id` is above
// 2^31 - 1.
std::optional<std::string> SystemRequestLine(uint32_t id,
                                             std::string_view request);

// Whether a compositor line of this `type` answers a system call, and so goes
// to the page as it arrived.
bool IsSystemAnswer(std::string_view type);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SYSTEM_CALL_H_
