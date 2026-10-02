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

TEST(UrlRegistryTest, AnAddressIsHandedToTheNewestPageOnly) {
  // A RELOAD HOLDS TWO CHANNELS FOR A MOMENT. Told to both, the address opens
  // twice; told to the old one, it opens in a page that is going.
  UrlRegistry registry;
  RecordingPage going(registry);
  RecordingPage reloaded(registry);

  EXPECT_TRUE(registry.Open("https://example.com/"));

  EXPECT_TRUE(going.opened().empty());
  EXPECT_EQ(reloaded.opened(),
            std::vector<std::string>{"https://example.com/"});
}

TEST(UrlRegistryTest, APageThatWentHandsItToTheOneBefore) {
  UrlRegistry registry;
  RecordingPage first(registry);
  RecordingPage second(registry);

  registry.RemovePage(second.id());
  EXPECT_TRUE(registry.Open("https://example.com/"));

  EXPECT_EQ(first.opened(), std::vector<std::string>{"https://example.com/"});
  EXPECT_TRUE(second.opened().empty());
}

TEST(UrlRegistryTest, NoPageIsSaidRatherThanDropped) {
  // The command socket refuses on this, so whoever ran `domicile open-url` is
  // told nothing opened rather than that it did.
  UrlRegistry registry;
  EXPECT_FALSE(registry.Open("https://example.com/"));
}

}  // namespace
}  // namespace domicile
