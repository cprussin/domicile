// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_PORTAL_REQUEST_H_
#define COMPONENTS_DOMICILE_BROWSER_PORTAL_REQUEST_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace domicile {

// The shell's answers to portal requests, relayed to the compositor without
// reading them. The compositor checks each answer against its request. See
// docs/PORTALS.md.

// The `answer_portal_request` line for request `id`, or nothing when `answer`
// is not a JSON object with a string `kind`, or `id` is above 2^31 - 1.
std::optional<std::string> PortalAnswerLine(uint32_t id,
                                            std::string_view answer);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_PORTAL_REQUEST_H_
