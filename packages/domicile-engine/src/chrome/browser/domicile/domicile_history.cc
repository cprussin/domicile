// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_history.h"

#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/barrier_callback.h"
#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/cancelable_task_tracker.h"
#include "base/time/time.h"
#include "base/types/expected.h"
#include "chrome/browser/browsing_data/chrome_browsing_data_remover_constants.h"
#include "chrome/browser/favicon/favicon_service_factory.h"
#include "chrome/browser/history/history_service_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "components/favicon/core/favicon_service.h"
#include "components/favicon_base/favicon_types.h"
#include "components/history/core/browser/history_service.h"
#include "components/history/core/browser/history_types.h"
#include "components/keyed_service/core/service_access_type.h"
#include "content/public/browser/browsing_data_filter_builder.h"
#include "content/public/browser/browsing_data_remover.h"
#include "net/base/registry_controlled_domains/registry_controlled_domain.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace domicile {
namespace {

// The favicon size the History app draws, which `_favicon/?size=32` gave it.
constexpr int kFaviconSize = 32;

// A page's favicon as a PNG, by the page's place in the results.
using IndexedFavicon = std::pair<size_t, std::vector<uint8_t>>;

// Tracks every history and favicon request. Nothing cancels them, so each
// command is answered; it lives as long as the command socket does.
base::CancelableTaskTracker& Tracker() {
  static base::NoDestructor<base::CancelableTaskTracker> tracker;
  return *tracker;
}

history::HistoryService& HistoryOf(Profile& profile) {
  return *HistoryServiceFactory::GetForProfile(
      &profile, ServiceAccessType::EXPLICIT_ACCESS);
}

void AddFavicons(base::WeakPtr<Profile> profile,
                 HistoryFound found,
                 history::QueryResults results);
void FaviconFound(size_t index,
                  base::RepeatingCallback<void(IndexedFavicon)> barrier,
                  const favicon_base::FaviconRawBitmapResult& favicon);
void WithFavicons(std::vector<HistoryEntry> entries,
                  HistoryFound found,
                  std::vector<IndexedFavicon> favicons);
uint64_t RemovalMaskFor(BrowsingDataKind kind);

// Runs `done` once the remover has carried out every removal it was handed,
// then deletes itself.
class Clearing : public content::BrowsingDataRemover::Observer {
 public:
  Clearing(content::BrowsingDataRemover& remover, CommandDone done)
      : done_(std::move(done)) {
    observation_.Observe(&remover);
  }

  Clearing(const Clearing&) = delete;
  Clearing& operator=(const Clearing&) = delete;

  ~Clearing() override = default;

  // Hands the remover `mask` since `since`, for the origins `filter` names,
  // from sites as `chrome.browsingData` clears them by default.
  void Remove(base::Time since,
              uint64_t mask,
              std::unique_ptr<content::BrowsingDataFilterBuilder> filter) {
    ++pending_;
    observation_.GetSource()->RemoveWithFilterAndReply(
        since, base::Time::Max(), mask,
        content::BrowsingDataRemover::ORIGIN_TYPE_UNPROTECTED_WEB,
        std::move(filter), this);
  }

  // Says that every removal has been handed over. The removals may already be
  // done, in which case this is deleted here.
  void Handed() { Finished(/*failed_data_types=*/0); }

  void OnBrowsingDataRemoverDone(uint64_t failed_data_types) override {
    Finished(failed_data_types);
  }

 private:
  void Finished(uint64_t failed_data_types) {
    failed_data_types_ |= failed_data_types;
    if (--pending_ > 0) {
      return;
    }
    observation_.Reset();
    if (failed_data_types_ == 0) {
      std::move(done_).Run(base::ok());
    } else {
      std::move(done_).Run(
          base::unexpected("Chrome could not clear all of the data"));
    }
    delete this;
  }

  // One for each removal, and one until `Handed`.
  int pending_ = 1;
  uint64_t failed_data_types_ = 0;
  CommandDone done_;
  base::ScopedObservation<content::BrowsingDataRemover,
                          content::BrowsingDataRemover::Observer>
      observation_{this};
};

}  // namespace

void SearchHistoryIn(Profile& profile,
                     const HistorySearch& search,
                     HistoryFound found) {
  history::QueryOptions options;
  options.end_time = search.end_time;
  options.max_count = search.max_results;
  // As `chrome.history.search` asks.
  options.policy_for_404_visits = history::VisitQuery404sPolicy::kExclude404s;
  options.include_actor_visits = true;
  HistoryOf(profile).QueryHistory(
      base::UTF8ToUTF16(search.text), options,
      base::BindOnce(&AddFavicons, profile.GetWeakPtr(), std::move(found)),
      &Tracker());
}

void ListVisitsIn(Profile& profile, const GURL& url, VisitsFound found) {
  HistoryOf(profile).QueryURLAndVisits(
      url, history::VisitQuery404sPolicy::kExclude404s,
      base::BindOnce(
          [](VisitsFound found, history::QueryURLAndVisitsResult result) {
            // Not a success when the page was never visited.
            std::vector<base::Time> times;
            if (result.success) {
              for (const history::VisitRow& visit : result.visits) {
                times.push_back(visit.visit_time);
              }
            }
            std::move(found).Run(base::ok(std::move(times)));
          },
          std::move(found)),
      &Tracker());
}

void DeleteVisitsIn(Profile& profile,
                    const std::vector<base::Time>& visits,
                    CommandDone done) {
  // Visit times are kept to the microsecond.
  std::vector<history::ExpireHistoryArgs> expiring;
  for (const base::Time& visit : visits) {
    history::ExpireHistoryArgs args;
    args.begin_time = visit;
    args.end_time = visit + base::Microseconds(1);
    expiring.push_back(args);
  }
  HistoryOf(profile).ExpireHistory(
      expiring,
      base::BindOnce(
          [](CommandDone done) { std::move(done).Run(base::ok()); },
          std::move(done)),
      &Tracker());
}

void ClearBrowsingDataIn(Profile& profile,
                         const BrowsingDataClearing& clearing,
                         CommandDone done) {
  uint64_t mask = 0;
  for (const BrowsingDataKind kind : clearing.kinds) {
    mask |= RemovalMaskFor(kind);
  }
  // Deletes itself once the remover is done.
  Clearing* removals =
      new Clearing(*profile.GetBrowsingDataRemover(), std::move(done));

  // Cookies apply to a whole registrable domain, not one origin, so a site's
  // cookies are those of its domain, as for `chrome.browsingData` and the
  // Clear-Site-Data header.
  if ((mask & content::BrowsingDataRemover::DATA_TYPE_COOKIES) != 0 &&
      !clearing.origins.empty()) {
    mask &= ~content::BrowsingDataRemover::DATA_TYPE_COOKIES;
    std::unique_ptr<content::BrowsingDataFilterBuilder> domains =
        content::BrowsingDataFilterBuilder::Create(
            content::BrowsingDataFilterBuilder::Mode::kDelete);
    for (const url::Origin& origin : clearing.origins) {
      const std::string domain =
          net::registry_controlled_domains::GetDomainAndRegistry(
              origin, net::registry_controlled_domains::
                          INCLUDE_PRIVATE_REGISTRIES);
      // An IP address or an internal hostname has no registrable domain.
      domains->AddRegisterableDomain(domain.empty() ? origin.host() : domain);
    }
    removals->Remove(clearing.since,
                     content::BrowsingDataRemover::DATA_TYPE_COOKIES,
                     std::move(domains));
  }
  if (mask != 0) {
    // With no origins, preserving none clears every site.
    std::unique_ptr<content::BrowsingDataFilterBuilder> sites =
        content::BrowsingDataFilterBuilder::Create(
            clearing.origins.empty()
                ? content::BrowsingDataFilterBuilder::Mode::kPreserve
                : content::BrowsingDataFilterBuilder::Mode::kDelete);
    for (const url::Origin& origin : clearing.origins) {
      sites->AddOrigin(origin);
    }
    removals->Remove(clearing.since, mask, std::move(sites));
  }
  removals->Handed();
}

namespace {

void AddFavicons(base::WeakPtr<Profile> profile,
                 HistoryFound found,
                 history::QueryResults results) {
  if (!profile) {
    std::move(found).Run(
        base::unexpected("the shell's profile closed during the search"));
    return;
  }
  std::vector<HistoryEntry> entries;
  for (const history::URLResult& result : results) {
    HistoryEntry entry;
    entry.url = result.url();
    entry.title = base::UTF16ToUTF8(result.title());
    entries.push_back(std::move(entry));
  }
  std::vector<GURL> pages;
  for (const HistoryEntry& entry : entries) {
    pages.push_back(entry.url);
  }

  favicon::FaviconService* favicons = FaviconServiceFactory::GetForProfile(
      profile.get(), ServiceAccessType::EXPLICIT_ACCESS);
  const base::RepeatingCallback<void(IndexedFavicon)> barrier =
      base::BarrierCallback<IndexedFavicon>(
          pages.size(), base::BindOnce(&WithFavicons, std::move(entries),
                                       std::move(found)));
  for (size_t index = 0; index < pages.size(); ++index) {
    // Falls back to the site's favicon, as `_favicon` did.
    favicons->GetRawFaviconForPageURL(
        pages[index], {favicon_base::IconType::kFavicon}, kFaviconSize,
        /*fallback_to_host=*/true,
        base::BindOnce(&FaviconFound, index, barrier), &Tracker());
  }
}

void FaviconFound(size_t index,
                  base::RepeatingCallback<void(IndexedFavicon)> barrier,
                  const favicon_base::FaviconRawBitmapResult& favicon) {
  // The favicon database keeps PNGs, and a resized one is encoded as a PNG.
  barrier.Run({index, favicon.is_valid()
                          ? std::vector<uint8_t>(favicon.bitmap_data->begin(),
                                                 favicon.bitmap_data->end())
                          : std::vector<uint8_t>()});
}

void WithFavicons(std::vector<HistoryEntry> entries,
                  HistoryFound found,
                  std::vector<IndexedFavicon> favicons) {
  for (IndexedFavicon& favicon : favicons) {
    entries[favicon.first].favicon_png = std::move(favicon.second);
  }
  std::move(found).Run(base::ok(std::move(entries)));
}

uint64_t RemovalMaskFor(BrowsingDataKind kind) {
  switch (kind) {
    case BrowsingDataKind::kCache:
      return content::BrowsingDataRemover::DATA_TYPE_CACHE;
    case BrowsingDataKind::kCacheStorage:
      return content::BrowsingDataRemover::DATA_TYPE_CACHE_STORAGE;
    case BrowsingDataKind::kCookies:
      return content::BrowsingDataRemover::DATA_TYPE_COOKIES;
    case BrowsingDataKind::kDownloads:
      return content::BrowsingDataRemover::DATA_TYPE_DOWNLOADS;
    case BrowsingDataKind::kFileSystems:
      return content::BrowsingDataRemover::DATA_TYPE_FILE_SYSTEMS;
    case BrowsingDataKind::kFormData:
      return chrome_browsing_data_remover::DATA_TYPE_FORM_DATA;
    case BrowsingDataKind::kHistory:
      return chrome_browsing_data_remover::DATA_TYPE_HISTORY;
    case BrowsingDataKind::kIndexedDB:
      return content::BrowsingDataRemover::DATA_TYPE_INDEXED_DB;
    case BrowsingDataKind::kLocalStorage:
      return content::BrowsingDataRemover::DATA_TYPE_LOCAL_STORAGE;
    case BrowsingDataKind::kPasswords:
      return chrome_browsing_data_remover::DATA_TYPE_PASSWORDS;
    case BrowsingDataKind::kServiceWorkers:
      return content::BrowsingDataRemover::DATA_TYPE_SERVICE_WORKERS;
    case BrowsingDataKind::kWebSQL:
      // Chromium no longer has WebSQL, and `chrome.browsingData` clears
      // nothing for it either.
      return 0;
  }
}

}  // namespace
}  // namespace domicile
