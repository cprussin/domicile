// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SHELL_FETCH_H_
#define COMPONENTS_DOMICILE_BROWSER_SHELL_FETCH_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/time/time.h"
#include "components/domicile/mojom/shell_fetch.mojom.h"

class GURL;

namespace domicile {

// What the browser checks and computes for a shell's fetch with the profile's
// cookies (components/domicile/mojom/shell_fetch.mojom). Making the request is
// chrome/browser/domicile/domicile_shell_fetch.h.

// The largest body the shell sends.
inline constexpr size_t kShellFetchMaxBody = 1024 * 1024;

// The largest answer the shell is handed. Gmail's inbox page, which the Gmail
// bar item reads for its sync's session, is over a megabyte.
inline constexpr size_t kShellFetchMaxAnswer = 8 * 1024 * 1024;

// How long a request may take, under the minute a bar item polls on.
inline constexpr base::TimeDelta kShellFetchTimeout = base::Seconds(30);

// Why the shell may not send to `url` with `headers`, hashed for
// `sapisid_hash_origin` if it is given, or nothing when it may.
//
// Refused: anything while the desk is locked, an address that is not https, a
// malformed header, a `Cookie` or `Origin` header or one the network stack
// sets itself, a hash origin that is not an https origin, and an
// `Authorization` header beside a hash, which is one.
std::optional<std::string> ShellFetchRefusal(
    const GURL& url,
    const std::vector<mojom::ShellFetchHeaderPtr>& headers,
    const std::optional<std::string>& sapisid_hash_origin,
    bool desk_locked);

// Why the shell may not send `method` with `body`, or nothing when it may.
// GET with no body, or POST with a body no larger than kShellFetchMaxBody.
std::optional<std::string> ShellFetchMethodRefusal(
    std::string_view method,
    const std::optional<std::string>& body);

// Whether a request follows redirects: only a GET without a SAPISIDHASH. A
// POST's body and a hash are for the address the page named.
bool ShellFetchFollowsRedirects(std::string_view method, bool hashed);

// Why the shell's request may not follow a redirect to `to`, or nothing when
// it may. Every address it reaches must be https, as the first must.
std::optional<std::string> ShellFetchRedirectRefusal(const GURL& to);

// The page's headers to drop before a redirect from `from` to `to`: every one
// when the redirect leaves `from`'s origin, which they were written for, and
// none within it.
std::vector<std::string> ShellFetchHeadersDroppedOnRedirect(
    const GURL& from,
    const GURL& to,
    const std::vector<mojom::ShellFetchHeaderPtr>& headers);

// The HTTP status `code` as the page reads it, or nothing for one outside
// 100 to 999. //net reads any integer as a status.
std::optional<uint16_t> ShellFetchStatus(int code);

// The SAPISID among a request's cookies, given by name and value: `SAPISID`,
// else `__Secure-3PAPISID`, which Google sets to the same value.
std::optional<std::string> SapisidAmong(
    const std::vector<std::pair<std::string, std::string>>& cookies);

// The `Authorization` value Google's first-party APIs take:
// `SAPISIDHASH <time>_<sha1 of "<time> <sapisid> <origin>" in hex>`.
std::string SapisidHash(std::string_view sapisid,
                        std::string_view origin,
                        int64_t unix_seconds);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SHELL_FETCH_H_
