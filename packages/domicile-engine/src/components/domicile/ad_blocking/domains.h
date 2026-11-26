// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_AD_BLOCKING_DOMAINS_H_
#define COMPONENTS_DOMICILE_AD_BLOCKING_DOMAINS_H_

#include <cstddef>

#include "third_party/rust/cxx/v1/cxx.h"

namespace domicile::ad_blocking {

// What adblock-rust asks of a host's domain (filter_engine.rs), from
// Chromium's registry of public suffixes, private registries included, as
// Brave answers it.

// How long `host`'s registrable domain (eTLD+1) is, counted from its end:
// all of `host` when it has none, as an IP address or a public suffix.
size_t domain_length(rust::Str host);

// Whether `domain` is itself a public suffix, such as `co.uk`.
bool is_public_suffix(rust::Str domain);

}  // namespace domicile::ad_blocking

#endif  // COMPONENTS_DOMICILE_AD_BLOCKING_DOMAINS_H_
