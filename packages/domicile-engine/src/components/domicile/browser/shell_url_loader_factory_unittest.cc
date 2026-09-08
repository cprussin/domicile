// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/shell_url_loader_factory.h"

#include "base/files/file_path.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

// The refusals are the point of this function, so they are what is tested.
// Resolving a path correctly is the easy half; a path resolver that is wrong
// about what it refuses hands out the filesystem.

base::FilePath Root() {
  return base::FilePath("/opt/domicile/shell");
}

bool Resolve(const std::string& url, base::FilePath* out) {
  return ShellURLLoaderFactory::ResolveShellPath(Root(), GURL(url), out);
}

TEST(ShellURLLoaderFactoryTest, ResolvesAFileUnderTheRoot) {
  base::FilePath path;
  ASSERT_TRUE(Resolve("domicile://shell/main.js", &path));
  EXPECT_EQ(path, Root().Append("main.js"));
}

TEST(ShellURLLoaderFactoryTest, ResolvesANestedFile) {
  base::FilePath path;
  ASSERT_TRUE(Resolve("domicile://shell/assets/icon.svg", &path));
  EXPECT_EQ(path, Root().Append("assets").Append("icon.svg"));
}

TEST(ShellURLLoaderFactoryTest, BareRootIsTheIndex) {
  base::FilePath path;
  ASSERT_TRUE(Resolve("domicile://shell/", &path));
  EXPECT_EQ(path, Root().Append("index.html"));
}

TEST(ShellURLLoaderFactoryTest, RefusesAnotherHost) {
  // One host. A second would be a second meaning for the scheme, arrived at by
  // accident.
  base::FilePath path;
  EXPECT_FALSE(Resolve("domicile://elsewhere/main.js", &path));
}

TEST(ShellURLLoaderFactoryTest, RefusesAnotherScheme) {
  base::FilePath path;
  EXPECT_FALSE(Resolve("https://shell/main.js", &path));
}

TEST(ShellURLLoaderFactoryTest, RefusesTraversal) {
  base::FilePath path;
  EXPECT_FALSE(Resolve("domicile://shell/../../etc/passwd", &path));
}

TEST(ShellURLLoaderFactoryTest, RefusesEscapedTraversal) {
  // The reason the path is percent-decoded before ReferencesParent() is asked:
  // a check that runs first reads an escape and sees nothing wrong.
  base::FilePath path;
  EXPECT_FALSE(Resolve("domicile://shell/%2e%2e%2f%2e%2e%2fetc/passwd", &path));
}

TEST(ShellURLLoaderFactoryTest, RefusesTraversalInTheMiddle) {
  base::FilePath path;
  EXPECT_FALSE(Resolve("domicile://shell/assets/../../../etc/passwd", &path));
}

TEST(ShellURLLoaderFactoryTest, RefusesAnEmbeddedNul) {
  // "index.html\0.png" would reach a different file than it appears to name,
  // because the filesystem stops at the NUL and a reader of the URL does not.
  base::FilePath path;
  EXPECT_FALSE(Resolve("domicile://shell/index.html%00.png", &path));
}

TEST(ShellURLLoaderFactoryTest, RefusesEverythingWithoutARoot) {
  // No --domicile-shell-root. There is nothing to serve, and guessing a
  // directory would be worse than saying so.
  base::FilePath path;
  EXPECT_FALSE(ShellURLLoaderFactory::ResolveShellPath(
      base::FilePath(), GURL("domicile://shell/main.js"), &path));
}

}  // namespace
}  // namespace domicile
