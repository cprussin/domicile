// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/app_roots.h"

#include <algorithm>
#include <string>
#include <string_view>

#include "base/containers/span.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/strings/string_util.h"
#include "base/strings/string_number_conversions.h"
#include "components/domicile/common/domicile_scheme.h"
#include "crypto/hash.h"

namespace domicile {

namespace {

// Half the hash: 128 bits keep two directories apart, and a host stays short.
constexpr size_t kIdBytes = 16;

}  // namespace

// static
AppRoots& AppRoots::Get() {
  static base::NoDestructor<AppRoots> roots;
  return *roots;
}

AppRoots::AppRoots() = default;

AppRoots::~AppRoots() = default;

std::string AppRoots::Add(const base::FilePath& root,
                          const std::string& module) {
  std::string host = AppHostFor(root);
  apps_.insert_or_assign(host, App{root, module});
  return host;
}

const AppRoots::App* AppRoots::Find(std::string_view host) const {
  const auto found = apps_.find(host);
  return found == apps_.end() ? nullptr : &found->second;
}

std::string AppHostFor(const base::FilePath& root) {
  const auto hash = crypto::hash::Sha256(root.value());
  return base::StrCat(
      {kDomicileAppHostPrefix,
       base::HexEncodeLower(base::span(hash).first<kIdBytes>())});
}

bool IsAppHost(std::string_view host) {
  if (!host.starts_with(kDomicileAppHostPrefix)) {
    return false;
  }
  const std::string_view id =
      host.substr(std::string_view(kDomicileAppHostPrefix).size());
  return id.size() == kIdBytes * 2 &&
         std::ranges::all_of(id, [](char c) {
           return base::IsAsciiDigit(c) || (c >= 'a' && c <= 'f');
         });
}

}  // namespace domicile
