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

TEST(ShellURLLoaderFactoryTest, PlainTraversalCannotEscape) {
  // Not a refusal, and the difference is worth stating. GURL normalises `..`
  // out of the path while parsing a standard scheme, so this never arrives as
  // traversal at all -- it arrives as "/etc/passwd" and resolves under the
  // shell root. The property that matters is containment, not rejection, so
  // that is what is asserted.
  base::FilePath path;
  ASSERT_TRUE(Resolve("domicile://shell/../../etc/passwd", &path));
  EXPECT_TRUE(Root().IsParent(path));
  EXPECT_EQ(path, Root().Append("etc").Append("passwd"));
}

TEST(ShellURLLoaderFactoryTest, AnythingResolvedIsInsideTheRoot) {
  // The one property everything else is in service of. Whatever the path
  // arithmetic and GURL's normalisation do between them, a path this function
  // accepts is under the shell root -- so a case nobody thought to write is
  // still contained.
  for (const char* url : {
           "domicile://shell/main.js",
           "domicile://shell/../../etc/passwd",
           "domicile://shell/assets/../../../etc/passwd",
           "domicile://shell/./main.js",
           "domicile://shell//main.js",
           "domicile://shell/a/b/c/../../d.js",
       }) {
    base::FilePath path;
    if (Resolve(url, &path)) {
      EXPECT_TRUE(Root().IsParent(path)) << url << " escaped to " << path;
    }
  }
}

TEST(ShellURLLoaderFactoryTest, RefusesEscapedTraversal) {
  // The reason the path is percent-decoded before ReferencesParent() is asked:
  // a check that runs first reads an escape and sees nothing wrong.
  base::FilePath path;
  EXPECT_FALSE(Resolve("domicile://shell/%2e%2e%2f%2e%2e%2fetc/passwd", &path));
}

TEST(ShellURLLoaderFactoryTest, TraversalInTheMiddleCannotEscape) {
  // Same: GURL collapses it before this is asked. Containment is the invariant.
  base::FilePath path;
  ASSERT_TRUE(Resolve("domicile://shell/assets/../../../etc/passwd", &path));
  EXPECT_TRUE(Root().IsParent(path));
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

TEST(ShellDocumentTest, WatchesItsOwnModuleForFailure) {
  // A module that 404s, will not parse, or throws on its first line leaves a
  // page that is blank and completely silent: the engine has served what it was
  // asked for, the compositor is waiting for a page that will never say hello,
  // and the only thing that knows what happened is the document itself. So the
  // document watches. The three listeners are three different failures -- the
  // module not loading, it throwing while it runs, and it rejecting -- and none
  // of the others reports the other two.
  const std::string document = ShellURLLoaderFactory::ShellDocument("shell.js");
  EXPECT_NE(document.find("document.currentScript"), std::string::npos);
  EXPECT_NE(document.find("shell.addEventListener(\"error\""),
            std::string::npos);
  EXPECT_NE(document.find("addEventListener(\"error\", (failure)"),
            std::string::npos);
  EXPECT_NE(document.find("addEventListener(\"unhandledrejection\""),
            std::string::npos);
}

TEST(ShellDocumentTest, NamesNothingAShellCouldCollideWith) {
  // THE REGRESSION, AND IT COST AN ENGINE RUN. The reporter found the module
  // script by an id, `domicile-shell`. `shell-manganese`'s `mountPoint` looks
  // up exactly that id to decide whether it has already made its mount point --
  // it picked the name for the same obvious reason this document did -- so it
  // found the script tag and returned it, React mounted the whole desktop
  // inside a <script>, and a <script> is `display: none`. The shell ran
  // perfectly: it connected, it embedded its window, it logged its diagnostics
  // every five seconds, and not one pixel of it was ever laid out. What the
  // guard read was "the client's window is not on manganese's page".
  //
  // An id in this document is a name in the shell's namespace, and this
  // document is the one thing every shell is written against. So it has none,
  // and the reporter reaches its module through `document.currentScript`, which
  // names nothing and cannot be collided with.
  const std::string document = ShellURLLoaderFactory::ShellDocument("shell.js");
  EXPECT_EQ(document.find("id="), std::string::npos);
}

TEST(ShellDocumentTest, LeavesTheBodyAsItFoundIt) {
  // The other half of the same rule. The reporter's own <script> element takes
  // itself back out once it has run, so what a shell finds is the body
  // `WRITING-A-SHELL.md` describes: one script tag and nothing else. A shell
  // that takes the body's first element, or counts its children, is written
  // against that document -- `mount-point.test.ts` builds exactly it as a
  // fixture -- and a diagnostic that changed it would be buying a report of
  // rare failures with a new everyday one.
  const std::string document = ShellURLLoaderFactory::ShellDocument("shell.js");
  EXPECT_NE(document.find("here.remove()"), std::string::npos);
}

TEST(ShellDocumentTest, SaysItOnTheScreenAndNotOnlyTheConsole) {
  // There is no devtools window on a desktop that did not come up, and no tab
  // strip to open one from -- `--app` is the whole point of the window. A
  // message only on the console is a message nobody reads.
  const std::string document = ShellURLLoaderFactory::ShellDocument("shell.js");
  EXPECT_NE(document.find("console.error"), std::string::npos);
  EXPECT_NE(document.find("document.body.append"), std::string::npos);
}

TEST(ShellDocumentTest, SaysNothingAboutAShellThatIsAlreadyRunning) {
  // The gate that keeps this from covering a working desktop: a shell that
  // loaded and then threw an hour later is the shell's own error to handle, and
  // painting a full-screen report over it would make this change the worst
  // thing on the page.
  const std::string document = ShellURLLoaderFactory::ShellDocument("shell.js");
  EXPECT_NE(document.find("shell.addEventListener(\"load\""),
            std::string::npos);
  EXPECT_NE(document.find("if (!ran)"), std::string::npos);
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
