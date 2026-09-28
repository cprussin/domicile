// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/extension_installer.h"

#include <map>
#include <set>
#include <string>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using Ids = std::vector<std::string>;

// Two Web Store ids and a directory, as a config names them.
constexpr char kStoreA[] = "ddkjiahejlhfcafbddmgiahcphecmpfh";
constexpr char kStoreB[] = "cjpalhdlnbpafiamejdnhcphjbkeiagm";
constexpr char kDirectory[] = "/home/you/src/my-extension";
// The id Chromium gives the extension in `kDirectory` once it is loaded.
constexpr char kLoaded[] = "aaaabbbbccccddddeeeeffffgggghhhh";

TEST(ExtensionInstallerTest, WhatIsNamedAndMissingIsInstalled) {
  // An installed id is never handed back: `PendingExtensionManager` treats a
  // second install of one as a bug, and a directory loaded again is an
  // extension restarted every time a shell window connects.
  const ExtensionChanges changes = ReconcileExtensions(
      ExtensionList{.web_store = {kStoreA, kStoreB}, .unpacked = {kDirectory}},
      /*installed=*/{kStoreA}, /*unpacked=*/{}, /*added=*/{});

  EXPECT_EQ(changes.install_from_web_store, Ids({kStoreB}));
  EXPECT_EQ(changes.load_unpacked, Ids({kDirectory}));
  EXPECT_TRUE(changes.uninstall.empty());
}

TEST(ExtensionInstallerTest, WhatIsNamedAndThereIsLeftAlone) {
  const ExtensionChanges changes = ReconcileExtensions(
      ExtensionList{.web_store = {kStoreA}, .unpacked = {kDirectory}},
      /*installed=*/{kStoreA, kLoaded},
      /*unpacked=*/{{kDirectory, kLoaded}},
      /*added=*/{kStoreA, kLoaded});

  EXPECT_TRUE(changes.install_from_web_store.empty());
  EXPECT_TRUE(changes.load_unpacked.empty());
  EXPECT_TRUE(changes.uninstall.empty());
}

TEST(ExtensionInstallerTest, OnlyWhatThisAddedIsTakenAway) {
  // kStoreB and the directory were this installer's and are no longer named;
  // kStoreA is the user's own. An id this added that is not installed any
  // more is not uninstalled: Chromium CHECKs that what it uninstalls exists.
  const ExtensionChanges changes = ReconcileExtensions(
      ExtensionList{}, /*installed=*/{kStoreA, kStoreB, kLoaded},
      /*unpacked=*/{{kDirectory, kLoaded}},
      /*added=*/{kStoreB, kLoaded, "gone"});

  EXPECT_TRUE(changes.install_from_web_store.empty());
  EXPECT_TRUE(changes.load_unpacked.empty());
  EXPECT_EQ(changes.uninstall, Ids({kLoaded, kStoreB}));
}

}  // namespace
}  // namespace domicile
