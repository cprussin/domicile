// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/ad_blocking/ad_blocker.h"

#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/json/json_reader.h"
#include "base/memory/ptr_util.h"
#include "base/strings/string_util.h"
#include "base/values.h"
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

rust::Vec<rust::String> RustStringsOf(const std::vector<std::string>& strings) {
  rust::Vec<rust::String> out;
  out.reserve(strings.size());
  for (const std::string& each : strings) {
    out.push_back(rust::String(each));
  }
  return out;
}

// The strings in `list`, or nothing if it holds anything else, or a string
// that is not UTF-8.
std::optional<std::vector<std::string>> StringsIn(const base::ListValue& list) {
  std::vector<std::string> strings;
  for (const base::Value& each : list) {
    if (!each.is_string() || !base::IsStringUTF8(each.GetString())) {
      return std::nullopt;
    }
    strings.push_back(each.GetString());
  }
  return strings;
}

rust::Box<ad_blocking::FilterEngine> EngineOf(
    const std::vector<std::string>& texts,
    const rust::Vec<ad_blocking::Scriptlet>& scriptlets) {
  rust::Box<ad_blocking::FilterSetBuilder> builder =
      ad_blocking::new_filter_set();
  for (const std::string& text : texts) {
    // rust::Str throws on a string that is not UTF-8, which the caller
    // checked: a list that is not is left out where it was read.
    CHECK(base::IsStringUTF8(text));
    builder->add_list(Str(text));
  }
  rust::Box<ad_blocking::FilterEngine> engine =
      ad_blocking::build(std::move(builder));
  engine->use_scriptlets(scriptlets);
  return engine;
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

AdBlocker::Scriptlet::Scriptlet() = default;
AdBlocker::Scriptlet::Scriptlet(const Scriptlet&) = default;
AdBlocker::Scriptlet::Scriptlet(Scriptlet&&) = default;
AdBlocker::Scriptlet& AdBlocker::Scriptlet::operator=(const Scriptlet&) =
    default;
AdBlocker::Scriptlet& AdBlocker::Scriptlet::operator=(Scriptlet&&) = default;
AdBlocker::Scriptlet::~Scriptlet() = default;

// static
std::optional<std::vector<AdBlocker::Scriptlet>> AdBlocker::ScriptletsIn(
    std::string_view text) {
  std::optional<base::Value> json =
      base::JSONReader::Read(text, base::JSON_PARSE_RFC);
  if (!json.has_value() || !json->is_list()) {
    return std::nullopt;
  }
  std::vector<Scriptlet> scriptlets;
  for (const base::Value& each : json->GetList()) {
    const base::DictValue* resource = each.GetIfDict();
    if (resource == nullptr) {
      return std::nullopt;
    }
    const std::string* name = resource->FindString("name");
    const std::string* content = resource->FindString("content");
    // `{"mime": "..."}`, or `"template"`, an older kind of scriptlet that
    // adblock-rust fills in the same way.
    const base::Value* kind = resource->Find("kind");
    if (name == nullptr || content == nullptr || kind == nullptr ||
        !base::IsStringUTF8(*name) || !base::IsStringASCII(*content)) {
      return std::nullopt;
    }
    std::string mime;
    if (kind->is_string() && kind->GetString() == "template") {
      mime = "application/javascript";
    } else if (const base::DictValue* of = kind->GetIfDict()) {
      const std::string* named = of->FindString("mime");
      if (named == nullptr) {
        return std::nullopt;
      }
      mime = *named;
    } else {
      return std::nullopt;
    }
    if (mime != "application/javascript" && mime != "fn/javascript") {
      continue;
    }
    if (resource->FindInt("permission").value_or(0) != 0) {
      continue;
    }
    Scriptlet scriptlet;
    scriptlet.name = *name;
    scriptlet.kind = std::move(mime);
    scriptlet.content = *content;
    for (const auto& [key, into] :
         {std::pair{"aliases", &scriptlet.aliases},
          std::pair{"dependencies", &scriptlet.dependencies}}) {
      const base::Value* found = resource->Find(key);
      if (found == nullptr) {
        continue;
      }
      std::optional<std::vector<std::string>> strings =
          found->is_list() ? StringsIn(found->GetList()) : std::nullopt;
      if (!strings.has_value()) {
        return std::nullopt;
      }
      *into = *std::move(strings);
    }
    scriptlets.push_back(std::move(scriptlet));
  }
  return scriptlets;
}

// static
std::unique_ptr<AdBlocker> AdBlocker::Build(
    const std::vector<std::string>& lists,
    const std::vector<std::string>& rules,
    const std::vector<std::string>& cookie_banner_lists,
    const std::vector<Scriptlet>& scriptlets) {
  std::string own;
  for (const std::string& rule : rules) {
    own += rule;
    own += '\n';
  }
  rust::Vec<ad_blocking::Scriptlet> rust_scriptlets;
  rust_scriptlets.reserve(scriptlets.size());
  for (const Scriptlet& scriptlet : scriptlets) {
    // ScriptletsIn checked: rust strings must be UTF-8.
    rust_scriptlets.push_back(ad_blocking::Scriptlet{
        .name = rust::String(scriptlet.name),
        .aliases = RustStringsOf(scriptlet.aliases),
        .kind = rust::String(scriptlet.kind),
        .content = rust::String(scriptlet.content),
        .dependencies = RustStringsOf(scriptlet.dependencies)});
  }
  return base::WrapUnique(new AdBlocker(std::make_unique<Engines>(Engines{
      .lists = EngineOf(lists, rust_scriptlets),
      .rules = EngineOf({own}, rust_scriptlets),
      .cookie_banners = EngineOf(cookie_banner_lists, rust_scriptlets)})));
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
    // Each engine's on its own: one's may define what it runs, and two
    // engines running the same scriptlet run it twice, as two rules would.
    cosmetics.script += std::string(found.injected_script);
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
