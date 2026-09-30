// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/url_registry.h"

#include <string>
#include <vector>

#include "base/functional/bind.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// A page that keeps the addresses it was handed. Registered against a registry
// on the stack, for the reason shortcut_registry_unittest.cc gives.
class RecordingPage {
 public:
  explicit RecordingPage(UrlRegistry& registry)
      : id_(registry.AddPage(base::BindRepeating(&RecordingPage::OnOpen,
                                                 base::Unretained(this)))) {}

  UrlRegistry::PageId id() const { return id_; }
  const std::vector<std::string>& opened() const { return opened_; }

 private:
  void OnOpen(const std::string& url) { opened_.push_back(url); }

  const UrlRegistry::PageId id_;
  std::vector<std::string> opened_;
};

TEST(UrlRegistryTest, AnAddressIsHandedToOnePage) {
  // EVERY PAGE OF A DESK IS THE SAME SHELL, so an address handed to each would
  // open a window per monitor. The first page is the one that is told.
  UrlRegistry registry;
  RecordingPage left(registry);
  RecordingPage right(registry);

  EXPECT_TRUE(registry.Open("https://example.com/"));

  EXPECT_EQ(left.opened(), std::vector<std::string>{"https://example.com/"});
  EXPECT_TRUE(right.opened().empty());
}

TEST(UrlRegistryTest, APageThatWentHandsItToTheNext) {
  UrlRegistry registry;
  RecordingPage left(registry);
  RecordingPage right(registry);

  registry.RemovePage(left.id());
  EXPECT_TRUE(registry.Open("https://example.com/"));

  EXPECT_TRUE(left.opened().empty());
  EXPECT_EQ(right.opened(), std::vector<std::string>{"https://example.com/"});
}

TEST(UrlRegistryTest, NoPageIsSaidRatherThanDropped) {
  // The command socket refuses on this, so whoever ran `domicile open-url` is
  // told nothing opened rather than that it did.
  UrlRegistry registry;
  EXPECT_FALSE(registry.Open("https://example.com/"));
}

}  // namespace
}  // namespace domicile
