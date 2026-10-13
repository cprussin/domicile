// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/app_roots.h"

#include "base/files/file_path.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

TEST(AppRootsTest, AnAppsHostIsTheHashOfItsRoot) {
  // python3 -c "import hashlib;
  //   print(hashlib.sha256(b'/opt/notes').hexdigest()[:32])"
  EXPECT_EQ(AppHostFor(base::FilePath("/opt/notes")),
            "app-3f34b27d8967e876d882c16c62df92be");
  EXPECT_NE(AppHostFor(base::FilePath("/opt/notes")),
            AppHostFor(base::FilePath("/opt/notes-2")));
}

TEST(AppRootsTest, FindsTheAppAddedAtAHost) {
  AppRoots roots;
  const std::string host =
      roots.Add(base::FilePath("/opt/notes"), "notes.js");

  const AppRoots::App* app = roots.Find(host);
  ASSERT_NE(app, nullptr);
  EXPECT_EQ(app->root, base::FilePath("/opt/notes"));
  EXPECT_EQ(app->module, "notes.js");
  EXPECT_EQ(roots.Find(AppHostFor(base::FilePath("/opt/other"))), nullptr);
}

TEST(AppRootsTest, AddingARootAgainReplacesItsModule) {
  AppRoots roots;
  roots.Add(base::FilePath("/opt/notes"), "notes.js");
  const std::string host =
      roots.Add(base::FilePath("/opt/notes"), "editor.js");

  EXPECT_EQ(roots.Find(host)->module, "editor.js");
}

TEST(AppRootsTest, KnowsTheShapeOfAnAppsHost) {
  EXPECT_TRUE(IsAppHost(AppHostFor(base::FilePath("/opt/notes"))));
  EXPECT_FALSE(IsAppHost("shell"));
  EXPECT_FALSE(IsAppHost("home"));
  EXPECT_FALSE(IsAppHost("app-"));
  EXPECT_FALSE(IsAppHost("app-3f34b27d8967e876d882c16c62df92b"));
  EXPECT_FALSE(IsAppHost("app-3F34B27D8967E876D882C16C62DF92BE"));
  EXPECT_FALSE(IsAppHost("app-3f34b27d8967e876d882c16c62df92bg"));
}

}  // namespace
}  // namespace domicile
