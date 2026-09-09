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

TEST(ShellURLLoaderFactoryTest, BareRootIsNotAFile) {
  // The bare root is the document the engine writes, answered before the
  // resolver is asked. There is no file it should resolve to, and an index.html
  // fallback here would be a second way to serve a shell that nobody chose.
  base::FilePath path;
  EXPECT_FALSE(Resolve("domicile://shell/", &path));
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

// The document. What is in it is not negotiable, so it is pinned rather than
// described: each of these is something a desktop cannot do without, and each
// has a failure that looks like something else when it is missing.

TEST(ShellDocumentTest, DeclaresACharset) {
  // Without one the page is decoded by guesswork.
  EXPECT_NE(ShellURLLoaderFactory::ShellDocument("shell.js")
                .find("charset=\"utf-8\""),
            std::string::npos);
}

TEST(ShellDocumentTest, DeclaresAViewport) {
  // Without one the engine lays out for a phone and every coordinate the
  // compositor is told about is wrong by a scale factor.
  EXPECT_NE(ShellURLLoaderFactory::ShellDocument("shell.js")
                .find("width=device-width, initial-scale=1"),
            std::string::npos);
}

TEST(ShellDocumentTest, HasNoBodyMargin) {
  // Eight pixels of body margin is eight pixels the compositor believes it has
  // and does not, and a client's window drawn in the wrong place looks like the
  // seam rather than like a stylesheet.
  EXPECT_NE(ShellURLLoaderFactory::ShellDocument("shell.js").find("margin: 0"),
            std::string::npos);
}

TEST(ShellDocumentTest, LoadsTheModuleAsAModule) {
  const std::string document = ShellURLLoaderFactory::ShellDocument("shell.js");
  EXPECT_NE(document.find("src=\"shell.js\""), std::string::npos);
  EXPECT_NE(document.find("type=\"module\""), std::string::npos);
}

TEST(ShellDocumentTest, EncodesTheModuleName) {
  // The name came off somebody's disk and lands in the most privileged page in
  // this system. Nothing in it may be parsed as markup.
  const std::string document =
      ShellURLLoaderFactory::ShellDocument("a\"><script>b.js");
  EXPECT_EQ(document.find("<script>b.js"), std::string::npos);
  EXPECT_EQ(document.find("a\">"), std::string::npos);
}

TEST(ShellDocumentTest, LeavesAHashInAFilenameAlone) {
  // `#` is legal in a POSIX filename and is not HTML-special, so an HTML
  // escaper would pass it through -- the browser would then ask for the part
  // before it and the desktop would be blank with nothing in any log.
  const std::string document = ShellURLLoaderFactory::ShellDocument("a#b.js");
  EXPECT_EQ(document.find("a#b.js"), std::string::npos);
  EXPECT_NE(document.find("a%23b.js"), std::string::npos);
}

}  // namespace
}  // namespace domicile
