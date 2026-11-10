// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/browser_window_listing.h"

#include <algorithm>
#include <utility>

#include "base/no_destructor.h"

namespace domicile {
namespace {

struct Listing {
  // Each source's windows, in the order each first listed one.
  std::vector<std::pair<const void*, std::vector<ListedBrowserWindow>>> sources;
  base::RepeatingClosureList watchers;
};

Listing& TheListing() {
  static base::NoDestructor<Listing> listing;
  return *listing;
}

}  // namespace

void ListBrowserWindows(const void* source,
                        std::vector<ListedBrowserWindow> windows) {
  Listing& listing = TheListing();
  auto found = std::ranges::find_if(
      listing.sources, [source](const auto& listed) {
        return listed.first == source;
      });
  if (found == listing.sources.end()) {
    if (windows.empty()) {
      return;
    }
    listing.sources.emplace_back(source, std::move(windows));
  } else if (found->second == windows) {
    // A capture starting or a navigation that kept the title: nothing a
    // capture tool lists changed.
    return;
  } else if (windows.empty()) {
    listing.sources.erase(found);
  } else {
    found->second = std::move(windows);
  }
  listing.watchers.Notify();
}

std::vector<ListedBrowserWindow> ListedBrowserWindows() {
  std::vector<ListedBrowserWindow> all;
  for (const auto& [source, windows] : TheListing().sources) {
    all.insert(all.end(), windows.begin(), windows.end());
  }
  return all;
}

base::CallbackListSubscription WatchBrowserWindowListing(
    base::RepeatingClosure changed) {
  return TheListing().watchers.Add(std::move(changed));
}

}  // namespace domicile
