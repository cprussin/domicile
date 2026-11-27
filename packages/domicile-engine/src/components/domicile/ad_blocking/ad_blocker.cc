// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/ad_blocking/ad_blocker.h"

#include <set>
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

rust::Vec<rust::String> RustStrings(const std::vector<std::string>& strings) {
  rust::Vec<rust::String> out;
  out.reserve(strings.size());
  for (const std::string& each : strings) {
    // Class and id names come from a page, which may hold anything; rust
    // strings must be UTF-8, and a selector that isn't matches no rule.
    if (base::IsStringUTF8(each)) {
      out.push_back(rust::String(each));
    }
  }
  return out;
}

void AddAll(std::set<std::string>& into,
            const rust::Vec<rust::String>& from) {
  for (const rust::String& each : from) {
    into.insert(std::string(each));
  }
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
  rust::Box<ad_blocking::FilterEngine> cookie_banners;
};

// static
std::unique_ptr<AdBlocker> AdBlocker::Build(
    const std::vector<std::string>& lists,
    const std::vector<std::string>& rules,
    const std::vector<std::string>& cookie_banner_lists) {
  std::string own;
  for (const std::string& rule : rules) {
    own += rule;
    own += '\n';
  }
  return base::WrapUnique(new AdBlocker(std::make_unique<Engines>(
      Engines{.lists = EngineOf(lists),
              .rules = EngineOf({own}),
              .cookie_banners = EngineOf(cookie_banner_lists)})));
}

AdBlocker::Cosmetics::Cosmetics() = default;
AdBlocker::Cosmetics::Cosmetics(Cosmetics&&) = default;
AdBlocker::Cosmetics& AdBlocker::Cosmetics::operator=(Cosmetics&&) = default;
AdBlocker::Cosmetics::~Cosmetics() = default;

AdBlocker::AdBlocker(std::unique_ptr<Engines> engines)
    : engines_(std::move(engines)) {}

AdBlocker::~AdBlocker() = default;

bool AdBlocker::ShouldBlock(const GURL& url,
                            const GURL& page,
                            std::string_view type,
                            std::string_view method,
                            bool block_first_party,
                            bool hide_cookie_banners) const {
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
  // Each list engine's exceptions are its own: one names what its own rules
  // went too far on.
  const ad_blocking::Verdict cookies = hide_cookie_banners
                                           ? check(*engines_->cookie_banners)
                                           : ad_blocking::Verdict{};
  if (mine.important || listed.important || cookies.important) {
    return true;
  }
  if (mine.exception) {
    return false;
  }
  if (mine.matched) {
    return true;
  }
  return ((listed.matched && !listed.exception) ||
          (cookies.matched && !cookies.exception)) &&
         (third_party || block_first_party);
}

AdBlocker::Cosmetics AdBlocker::CosmeticsFor(const GURL& page,
                                             bool hide_cookie_banners) const {
  Cosmetics cosmetics;
  if (!page.SchemeIsHTTPOrHTTPS()) {
    return cosmetics;
  }
  std::set<std::string> hide;
  std::set<std::string> exceptions;
  const auto add = [&](const ad_blocking::FilterEngine& engine) {
    const ad_blocking::Cosmetics found = engine.cosmetics(Str(page.spec()));
    AddAll(hide, found.hide_selectors);
    AddAll(exceptions, found.exceptions);
    cosmetics.generichide = cosmetics.generichide || found.generichide;
  };
  add(*engines_->rules);
  add(*engines_->lists);
  if (hide_cookie_banners) {
    add(*engines_->cookie_banners);
  }
  cosmetics.hide_selectors.assign(hide.begin(), hide.end());
  cosmetics.exceptions.assign(exceptions.begin(), exceptions.end());
  return cosmetics;
}

std::vector<std::string> AdBlocker::HiddenClassIdSelectors(
    const std::vector<std::string>& classes,
    const std::vector<std::string>& ids,
    const std::vector<std::string>& exceptions,
    bool hide_cookie_banners) const {
  const rust::Vec<rust::String> rust_classes = RustStrings(classes);
  const rust::Vec<rust::String> rust_ids = RustStrings(ids);
  const rust::Vec<rust::String> rust_exceptions = RustStrings(exceptions);
  std::set<std::string> selectors;
  const auto add = [&](const ad_blocking::FilterEngine& engine) {
    AddAll(selectors, engine.hidden_class_id_selectors(rust_classes, rust_ids,
                                                       rust_exceptions));
  };
  add(*engines_->rules);
  add(*engines_->lists);
  if (hide_cookie_banners) {
    add(*engines_->cookie_banners);
  }
  return std::vector<std::string>(selectors.begin(), selectors.end());
}

}  // namespace domicile
