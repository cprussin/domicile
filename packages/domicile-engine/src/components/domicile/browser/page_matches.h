// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_PAGE_MATCHES_H_
#define COMPONENTS_DOMICILE_BROWSER_PAGE_MATCHES_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

#include "base/values.h"

namespace domicile {

// How a shell counts the elements in a <webview>'s page that match a CSS
// selector. See WebViewGuest.CountMatches in
// components/domicile/mojom/web_view_guest.mojom.

// The script that counts `selector`'s matches in the page's document. The
// selector is a JSON string literal in it, so no selector can end the call
// and run script of its own.
std::u16string CountMatchesScript(std::string_view selector);

// The count the script answered with, or nothing when it threw or the page
// went before it ran: either way the result is not a number.
std::optional<int32_t> CountFrom(const base::Value& result);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_PAGE_MATCHES_H_
