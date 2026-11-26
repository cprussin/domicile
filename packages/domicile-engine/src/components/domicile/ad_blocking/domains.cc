// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/ad_blocking/domains.h"

#include <string>
#include <string_view>

#include "net/base/registry_controlled_domains/registry_controlled_domain.h"

namespace domicile::ad_blocking {

namespace {

using net::registry_controlled_domains::INCLUDE_PRIVATE_REGISTRIES;

std::string_view View(rust::Str text) {
  return std::string_view(text.data(), text.size());
}

}  // namespace

size_t domain_length(rust::Str host) {
  const std::string domain =
      net::registry_controlled_domains::GetDomainAndRegistry(
          View(host), INCLUDE_PRIVATE_REGISTRIES);
  return domain.empty() ? host.size() : domain.size();
}

bool is_public_suffix(rust::Str domain) {
  return net::registry_controlled_domains::HostIsRegistryIdentifier(
      View(domain), INCLUDE_PRIVATE_REGISTRIES);
}

}  // namespace domicile::ad_blocking
