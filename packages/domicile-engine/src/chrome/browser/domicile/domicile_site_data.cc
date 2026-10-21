// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_site_data.h"

#include <map>
#include <memory>
#include <set>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include "base/barrier_closure.h"
#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/types/expected.h"
#include "chrome/browser/browsing_data/chrome_browsing_data_model_delegate.h"
#include "chrome/browser/profiles/profile.h"
#include "components/browsing_data/content/browsing_data_model.h"
#include "url/origin.h"
#include "url/url_constants.h"

namespace domicile {
namespace {

void SiteDataOf(SiteDataFound found, std::unique_ptr<BrowsingDataModel> model);
void RemoveHost(const std::string& host,
                CommandDone done,
                std::unique_ptr<BrowsingDataModel> model);
bool IsASite(const BrowsingDataModel::DataOwner& owner);

void BuildModel(
    Profile& profile,
    base::OnceCallback<void(std::unique_ptr<BrowsingDataModel>)> built) {
  BrowsingDataModel::BuildFromDisk(
      &profile, ChromeBrowsingDataModelDelegate::CreateForProfile(&profile),
      std::move(built));
}

}  // namespace

void ListSiteDataIn(Profile& profile, SiteDataFound found) {
  BuildModel(profile, base::BindOnce(&SiteDataOf, std::move(found)));
}

void ClearSiteDataIn(Profile& profile,
                     const std::string& host,
                     CommandDone done) {
  BuildModel(profile, base::BindOnce(&RemoveHost, host, std::move(done)));
}

namespace {

// Sums each host's entries: the model keeps a host's cookies apart from each
// of its origins' storage.
void SiteDataOf(SiteDataFound found,
                std::unique_ptr<BrowsingDataModel> model) {
  std::map<std::string, StoredSiteData> hosts;
  for (const BrowsingDataModel::BrowsingDataEntryView& entry : *model) {
    if (!IsASite(*entry.data_owner)) {
      continue;
    }
    const std::string host = BrowsingDataModel::GetHost(*entry.data_owner);
    StoredSiteData& site = hosts[host];
    site.host = host;
    site.bytes += entry.data_details->storage_size;
    site.cookies += entry.data_details->cookie_count;
  }
  std::vector<StoredSiteData> sites;
  for (auto& [host, site] : hosts) {
    sites.push_back(std::move(site));
  }
  std::move(found).Run(std::move(sites));
}

// Removes every owner whose host is `host`, then runs `done`. The model lives
// until the last removal is done, as its delegate removes some kinds.
void RemoveHost(const std::string& host,
                CommandDone done,
                std::unique_ptr<BrowsingDataModel> model) {
  std::set<BrowsingDataModel::DataOwner> owners;
  for (const BrowsingDataModel::BrowsingDataEntryView& entry : *model) {
    if (IsASite(*entry.data_owner) &&
        BrowsingDataModel::GetHost(*entry.data_owner) == host) {
      owners.insert(*entry.data_owner);
    }
  }
  BrowsingDataModel* removing = model.get();
  // One more than the owners, run below, so `model` outlives every call into
  // it even when a removal finishes at once.
  const base::RepeatingClosure removed = base::BarrierClosure(
      owners.size() + 1,
      base::BindOnce(
          [](std::unique_ptr<BrowsingDataModel> model, CommandDone done) {
            std::move(done).Run(base::ok());
          },
          std::move(model), std::move(done)));
  for (const BrowsingDataModel::DataOwner& owner : owners) {
    removing->RemoveBrowsingData(owner, removed);
  }
  removed.Run();
}

// Whether `owner` is a web site. The model also holds the data of extensions
// and of Domicile's own pages, which the Settings app does not list.
bool IsASite(const BrowsingDataModel::DataOwner& owner) {
  const url::Origin* origin = std::get_if<url::Origin>(&owner);
  return origin == nullptr || origin->scheme() == url::kHttpsScheme ||
         origin->scheme() == url::kHttpScheme;
}

}  // namespace
}  // namespace domicile
