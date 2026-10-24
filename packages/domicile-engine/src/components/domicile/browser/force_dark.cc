// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/force_dark.h"

#include <algorithm>
#include <utility>

#include "base/no_destructor.h"
#include "url/gurl.h"

namespace domicile {
namespace {

std::vector<std::string>& Sites() {
  static base::NoDestructor<std::vector<std::string>> sites;
  return *sites;
}

}  // namespace

void SetForceDarkSites(std::vector<std::string> sites) {
  Sites() = std::move(sites);
}

bool ForcesDark(const GURL& url, bool dark) {
  return dark && std::ranges::any_of(Sites(), [&](const std::string& site) {
           return url.DomainIs(site);
         });
}

}  // namespace domicile
