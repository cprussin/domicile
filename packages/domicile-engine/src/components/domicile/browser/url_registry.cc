// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/url_registry.h"

#include <utility>

#include "base/no_destructor.h"

namespace domicile {

// static
UrlRegistry& UrlRegistry::Get() {
  static base::NoDestructor<UrlRegistry> registry;
  return *registry;
}

UrlRegistry::UrlRegistry() = default;

UrlRegistry::~UrlRegistry() = default;

UrlRegistry::PageId UrlRegistry::AddPage(OpenCallback on_open) {
  base::AutoLock held(lock_);
  const PageId id = next_id_++;
  pages_.push_back(Page{id, std::move(on_open)});
  return id;
}

void UrlRegistry::RemovePage(PageId page) {
  base::AutoLock held(lock_);
  std::erase_if(pages_,
                [page](const Page& registered) { return registered.id == page; });
}

bool UrlRegistry::Open(const std::string& url) {
  // Copied out under the lock and run outside it, for ShortcutRegistry::Press's
  // reason.
  OpenCallback tell;
  {
    base::AutoLock held(lock_);
    if (pages_.empty()) {
      return false;
    }
    tell = pages_.front().on_open;
  }
  tell.Run(url);
  return true;
}

}  // namespace domicile
