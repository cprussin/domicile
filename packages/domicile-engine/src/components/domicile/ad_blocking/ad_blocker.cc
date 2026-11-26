// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/ad_blocking/ad_blocker.h"

#include <utility>

#include "base/check.h"
#include "base/memory/ptr_util.h"
#include "base/strings/string_util.h"
#include "components/domicile/ad_blocking/filter_engine.rs.h"
#include "net/base/registry_controlled_domains/registry_controlled_domain.h"
#include "url/gurl.h"

namespace domicile {

namespace {

using network::mojom::RequestDestination;

rust::Str Str(std::string_view text) {
  return rust::Str(text.data(), text.size());
}

rust::Box<ad_blocking::FilterEngine> EngineOf(
    const std::vector<std::string>& texts) {
  rust::Box<ad_blocking::FilterSetBuilder> builder =
      ad_blocking::new_filter_set();
  for (const std::string& text : texts) {
    // rust::Str throws on a string that is not UTF-8, which the caller
    // checked: a list that is not is left out where it was read.
    CHECK(base::IsStringUTF8(text));
    builder->add_list(Str(text));
  }
  return ad_blocking::build(std::move(builder));
}

}  // namespace

std::string_view AdBlockRequestType(RequestDestination destination) {
  switch (destination) {
    case RequestDestination::kEmpty:
      // fetch() and XMLHttpRequest, and sendBeacon.
      return "xmlhttprequest";
    case RequestDestination::kDocument:
      return "document";
    case RequestDestination::kFrame:
    case RequestDestination::kIframe:
    case RequestDestination::kFencedframe:
      return "subdocument";
    case RequestDestination::kScript:
    case RequestDestination::kWorker:
    case RequestDestination::kSharedWorker:
    case RequestDestination::kServiceWorker:
    case RequestDestination::kAudioWorklet:
    case RequestDestination::kPaintWorklet:
      return "script";
    case RequestDestination::kStyle:
      return "stylesheet";
    case RequestDestination::kImage:
      return "image";
    case RequestDestination::kFont:
      return "font";
    case RequestDestination::kAudio:
    case RequestDestination::kVideo:
    case RequestDestination::kTrack:
      return "media";
    case RequestDestination::kEmbed:
    case RequestDestination::kObject:
      return "object";
    case RequestDestination::kReport:
      return "ping";
    default:
      return "other";
  }
}

struct AdBlocker::Engines {
  rust::Box<ad_blocking::FilterEngine> lists;
  rust::Box<ad_blocking::FilterEngine> rules;
};

// static
std::unique_ptr<AdBlocker> AdBlocker::Build(
    const std::vector<std::string>& lists,
    const std::vector<std::string>& rules) {
  std::string own;
  for (const std::string& rule : rules) {
    own += rule;
    own += '\n';
  }
  return base::WrapUnique(new AdBlocker(std::make_unique<Engines>(
      Engines{.lists = EngineOf(lists), .rules = EngineOf({own})})));
}

AdBlocker::AdBlocker(std::unique_ptr<Engines> engines)
    : engines_(std::move(engines)) {}

AdBlocker::~AdBlocker() = default;

bool AdBlocker::ShouldBlock(const GURL& url,
                            const GURL& page,
                            std::string_view type,
                            std::string_view method,
                            bool block_first_party) const {
  const bool third_party =
      !net::registry_controlled_domains::SameDomainOrHost(
          url, page,
          net::registry_controlled_domains::INCLUDE_PRIVATE_REGISTRIES);
  const auto check = [&](const ad_blocking::FilterEngine& engine) {
    return engine.check(Str(url.spec()), Str(url.host()), Str(page.host()),
                        Str(type), third_party, Str(method));
  };
  const ad_blocking::Verdict mine = check(*engines_->rules);
  const ad_blocking::Verdict listed = check(*engines_->lists);
  if (mine.important || listed.important) {
    return true;
  }
  if (mine.exception) {
    return false;
  }
  if (mine.matched) {
    return true;
  }
  return listed.matched && !listed.exception &&
         (third_party || block_first_party);
}

}  // namespace domicile
