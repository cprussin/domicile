// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shell_fetch.h"

#include <algorithm>

#include "base/containers/span.h"
#include "base/hash/sha1.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "net/http/http_util.h"
#include "services/network/public/cpp/header_util.h"
#include "url/gurl.h"
#include "url/origin.h"
#include "url/url_constants.h"

namespace domicile {

namespace {

// Why `header` may not be sent, or nothing.
std::optional<std::string> HeaderRefusal(const mojom::ShellFetchHeader& header,
                                         bool hashed) {
  if (!net::HttpUtil::IsValidHeaderName(header.name) ||
      !net::HttpUtil::IsValidHeaderValue(header.value)) {
    return base::StrCat({"the header ", header.name, " is malformed"});
  }
  // The profile's cookies are the point; a page's own would be mixed in.
  if (base::EqualsCaseInsensitiveASCII(header.name, "Cookie")) {
    return "the browser sends the profile's cookies; a page sends none";
  }
  if (!network::IsRequestHeaderSafe(header.name, header.value)) {
    return base::StrCat({"the header ", header.name, " is the browser's"});
  }
  if (hashed &&
      base::EqualsCaseInsensitiveASCII(header.name, "Authorization")) {
    return "a SAPISIDHASH is the Authorization header";
  }
  return std::nullopt;
}

// Whether `origin` is an https origin as `Origin` spells it.
bool IsHttpsOrigin(const std::string& origin) {
  const GURL url(origin);
  return url.is_valid() && url.SchemeIs(url::kHttpsScheme) &&
         url::Origin::Create(url).Serialize() == origin;
}

}  // namespace

std::optional<std::string> ShellFetchRefusal(
    const GURL& url,
    const std::vector<mojom::ShellFetchHeaderPtr>& headers,
    const std::optional<std::string>& sapisid_hash_origin,
    bool desk_locked) {
  if (desk_locked) {
    return "the desk is locked";
  }
  if (!url.is_valid() || !url.SchemeIs(url::kHttpsScheme)) {
    return "only an https address may be fetched";
  }
  if (sapisid_hash_origin.has_value() &&
      !IsHttpsOrigin(*sapisid_hash_origin)) {
    return "the SAPISIDHASH origin must be an https origin";
  }
  for (const mojom::ShellFetchHeaderPtr& header : headers) {
    std::optional<std::string> refusal =
        HeaderRefusal(*header, sapisid_hash_origin.has_value());
    if (refusal.has_value()) {
      return refusal;
    }
  }
  return std::nullopt;
}

std::optional<std::string> ShellFetchRedirectRefusal(const GURL& to) {
  if (!to.is_valid() || !to.SchemeIs(url::kHttpsScheme)) {
    return "a redirect left https";
  }
  return std::nullopt;
}

std::vector<std::string> ShellFetchHeadersDroppedOnRedirect(
    const GURL& from,
    const GURL& to,
    const std::vector<mojom::ShellFetchHeaderPtr>& headers) {
  std::vector<std::string> dropped;
  if (!url::IsSameOriginWith(from, to)) {
    for (const mojom::ShellFetchHeaderPtr& header : headers) {
      dropped.push_back(header->name);
    }
  }
  return dropped;
}

std::optional<uint16_t> ShellFetchStatus(int code) {
  if (code < 100 || code > 999) {
    return std::nullopt;
  }
  return static_cast<uint16_t>(code);
}

std::optional<std::string> SapisidAmong(
    const std::vector<std::pair<std::string, std::string>>& cookies) {
  for (const char* name : {"SAPISID", "__Secure-3PAPISID"}) {
    const auto found = std::ranges::find_if(
        cookies, [name](const std::pair<std::string, std::string>& cookie) {
          return cookie.first == name;
        });
    if (found != cookies.end()) {
      return found->second;
    }
  }
  return std::nullopt;
}

std::string SapisidHash(std::string_view sapisid,
                        std::string_view origin,
                        int64_t unix_seconds) {
  const std::string time = base::NumberToString(unix_seconds);
  const std::string hashed = base::StrCat({time, " ", sapisid, " ", origin});
  const base::SHA1Digest digest = base::SHA1Hash(base::as_byte_span(hashed));
  return base::StrCat(
      {"SAPISIDHASH ", time, "_", base::HexEncodeLower(base::span(digest))});
}

}  // namespace domicile
