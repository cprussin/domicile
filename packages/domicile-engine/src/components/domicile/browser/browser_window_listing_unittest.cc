// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/browser_window_listing.h"

#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// Two profiles' worth of sources.
const int kProfile = 1;
const int kPrivateProfile = 2;

ListedBrowserWindow Window(std::string id, std::string title) {
  return ListedBrowserWindow{.id = std::move(id), .title = std::move(title)};
}

class BrowserWindowListingTest : public testing::Test {
 protected:
  void TearDown() override {
    ListBrowserWindows(&kProfile, {});
    ListBrowserWindows(&kPrivateProfile, {});
  }
};

TEST_F(BrowserWindowListingTest, EachSourcesWindowsAreListedInTheOrderItCame) {
  ListBrowserWindows(&kProfile, {Window("1", "Mail"), Window("2", "News")});
  ListBrowserWindows(&kPrivateProfile, {Window("1", "Private")});

  EXPECT_EQ(ListedBrowserWindows(),
            (std::vector<ListedBrowserWindow>{
                Window("1", "Mail"), Window("2", "News"),
                Window("1", "Private")}));
}

TEST_F(BrowserWindowListingTest, ASourceThatListsNothingTakesItsWindowsAway) {
  ListBrowserWindows(&kProfile, {Window("1", "Mail")});
  ListBrowserWindows(&kPrivateProfile, {Window("1", "Private")});

  ListBrowserWindows(&kProfile, {});

  EXPECT_EQ(ListedBrowserWindows(),
            std::vector<ListedBrowserWindow>{Window("1", "Private")});
}

TEST_F(BrowserWindowListingTest, OnlyAChangeToTheListIsNews) {
  int changes = 0;
  base::CallbackListSubscription watching = WatchBrowserWindowListing(
      base::BindRepeating([](int* changes) { ++*changes; }, &changes));

  ListBrowserWindows(&kProfile, {Window("1", "Mail")});
  // A capture of the window starting changes nothing listed.
  ListBrowserWindows(&kProfile, {Window("1", "Mail")});
  ListBrowserWindows(&kProfile, {Window("1", "Mail (1)")});
  // Nor does a source with no windows listing none.
  ListBrowserWindows(&kPrivateProfile, {});

  EXPECT_EQ(changes, 2);
}

}  // namespace
}  // namespace domicile
