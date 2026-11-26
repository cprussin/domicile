// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/link_tracking.h"

#include <string>
#include <string_view>
#include <vector>

#include "base/containers/fixed_flat_set.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"

namespace domicile {

namespace {

// Brave's query filter's list (brave-core components/query_filter), and
// Instagram's share id: each only names the click that brought the page, for
// the site that tracks it.
constexpr auto kClickIds = base::MakeFixedFlatSet<std::string_view>({
    "__hsfp",
    "__hssc",
    "__hstc",
    "__s",
    "_branch_match_id",
    "_branch_referrer",
    "_gl",
    "_hsenc",
    "_kx",
    "_openstat",
    "at_recipient_id",
    "at_recipient_list",
    "bbeml",
    "bsft_clkid",
    "bsft_uid",
    "dclid",
    "et_rid",
    "fb_action_ids",
    "fb_comment_id",
    "fbclid",
    "gbraid",
    "gclid",
    "guce_referrer",
    "guce_referrer_sig",
    "hsCtaTracking",
    "igshid",
    "irclickid",
    "mc_eid",
    "ml_subscriber",
    "ml_subscriber_hash",
    "msclkid",
    "mtm_cid",
    "oft_c",
    "oft_ck",
    "oft_d",
    "oft_id",
    "oft_ids",
    "oft_k",
    "oft_lk",
    "oft_sk",
    "oly_anon_id",
    "oly_enc_id",
    "pk_cid",
    "rb_clickid",
    "s_cid",
    "sc_cid",
    "ss_email_id",
    "twclid",
    "unicorn_click_id",
    "vero_conv",
    "vero_id",
    "vgo_ee",
    "wbraid",
    "wickedid",
    "yclid",
    "ymclid",
    "ysclid",
});

// A parameter's name: up to its `=`, as written.
std::string_view NameOf(std::string_view parameter) {
  return parameter.substr(0, parameter.find('='));
}

bool IsTracking(std::string_view name, bool strict) {
  return kClickIds.contains(name) ||
         (strict && base::StartsWith(name, "utm_"));
}

}  // namespace

std::optional<GURL> WithoutTracking(const GURL& url, bool strict) {
  if (!url.SchemeIsHTTPOrHTTPS() || !url.has_query()) {
    return std::nullopt;
  }
  std::vector<std::string_view> kept;
  bool dropped = false;
  for (std::string_view parameter : base::SplitStringPiece(
           url.query(), "&", base::KEEP_WHITESPACE, base::SPLIT_WANT_ALL)) {
    if (IsTracking(NameOf(parameter), strict)) {
      dropped = true;
    } else {
      kept.push_back(parameter);
    }
  }
  if (!dropped) {
    return std::nullopt;
  }
  GURL::Replacements replacements;
  const std::string query = base::JoinString(kept, "&");
  if (query.empty()) {
    replacements.ClearQuery();
  } else {
    replacements.SetQueryStr(query);
  }
  return url.ReplaceComponents(replacements);
}

}  // namespace domicile
