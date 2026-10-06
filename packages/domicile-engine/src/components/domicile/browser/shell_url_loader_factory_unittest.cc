// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shell_url_loader_factory.h"

#include "base/files/file_path.h"
#include "components/domicile/common/domicile_scheme.h"
#include "net/http/http_response_headers.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"
#include "url/origin.h"
#include "url/url_util.h"

namespace domicile {
namespace {

// Most tests cover refusals: a resolver that accepts too much exposes the
// filesystem.

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
  // The bare root is the generated document, never a file such as index.html.
  base::FilePath path;
  EXPECT_FALSE(Resolve("domicile://shell/", &path));
}

TEST(ShellURLLoaderFactoryTest, RefusesAnotherHost) {
  base::FilePath path;
  EXPECT_FALSE(Resolve("domicile://elsewhere/main.js", &path));
}

TEST(ShellURLLoaderFactoryTest, RefusesAnotherScheme) {
  base::FilePath path;
  EXPECT_FALSE(Resolve("https://shell/main.js", &path));
}

TEST(ShellURLLoaderFactoryTest, PlainTraversalCannotEscape) {
  // GURL normalizes `..` away, so this resolves to "/etc/passwd" under the
  // root. The test asserts containment, not refusal.
  base::FilePath path;
  ASSERT_TRUE(Resolve("domicile://shell/../../etc/passwd", &path));
  EXPECT_TRUE(Root().IsParent(path));
  EXPECT_EQ(path, Root().Append("etc").Append("passwd"));
}

TEST(ShellURLLoaderFactoryTest, AnythingResolvedIsInsideTheRoot) {
  // The core invariant: any accepted path is under the root.
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
  // Requires decoding before the ReferencesParent() check.
  base::FilePath path;
  EXPECT_FALSE(Resolve("domicile://shell/%2e%2e%2f%2e%2e%2fetc/passwd", &path));
}

TEST(ShellURLLoaderFactoryTest, TraversalInTheMiddleCannotEscape) {
  // GURL collapses this too; assert containment.
  base::FilePath path;
  ASSERT_TRUE(Resolve("domicile://shell/assets/../../../etc/passwd", &path));
  EXPECT_TRUE(Root().IsParent(path));
}

TEST(ShellURLLoaderFactoryTest, RefusesAnEmbeddedNul) {
  // The filesystem would stop at the NUL and open "index.html".
  base::FilePath path;
  EXPECT_FALSE(Resolve("domicile://shell/index.html%00.png", &path));
}

TEST(ShellURLLoaderFactoryTest, RefusesEverythingWithoutARoot) {
  // No --domicile-shell-root.
  base::FilePath path;
  EXPECT_FALSE(ShellURLLoaderFactory::ResolveShellPath(
      base::FilePath(), GURL("domicile://shell/main.js"), &path));
}

base::FilePath Home() {
  return base::FilePath("/home/you");
}

bool ResolveHome(const std::string& url, base::FilePath* out) {
  return ShellURLLoaderFactory::ResolveHomePath(Home(), GURL(url), out);
}

TEST(ShellURLLoaderFactoryTest, ResolvesAFileUnderHome) {
  // The launcher previews files by the path the compositor's search returned.
  base::FilePath path;
  ASSERT_TRUE(ResolveHome("domicile://home/Pictures/cat%20one.png", &path));
  EXPECT_EQ(path, Home().Append("Pictures").Append("cat one.png"));
}

TEST(ShellURLLoaderFactoryTest, RefusesADotfileUnderHome) {
  // Matches the compositor's index, which skips dotfiles. This keeps keys and
  // tokens unreachable, escaped or not.
  base::FilePath path;
  EXPECT_FALSE(ResolveHome("domicile://home/.ssh/id_ed25519", &path));
  EXPECT_FALSE(ResolveHome("domicile://home/src/.git/HEAD", &path));
  EXPECT_FALSE(ResolveHome("domicile://home/%2essh/id_ed25519", &path));
}

TEST(ShellURLLoaderFactoryTest, HomeAndShellAreTwoPlaces) {
  // Each resolver answers for its own host only, so neither root can be
  // reached through the other's name.
  base::FilePath path;
  EXPECT_FALSE(ResolveHome("domicile://shell/main.js", &path));
  EXPECT_FALSE(Resolve("domicile://home/main.js", &path));
}

TEST(ShellURLLoaderFactoryTest, AnythingResolvedUnderHomeIsInsideIt) {
  for (const char* url : {
           "domicile://home/../../etc/passwd",
           "domicile://home/a/../../b.png",
           "domicile://home//etc/passwd",
       }) {
    base::FilePath path;
    if (ResolveHome(url, &path)) {
      EXPECT_TRUE(Home().IsParent(path)) << url;
    }
  }
}

TEST(ShellURLLoaderFactoryTest, OnlyTheShellMayAskForHome) {
  // Every frame uses this factory, including sites in a <webview>. A site that
  // could load domicile://home/ in an <img> would learn which files exist.
  //
  // Register the scheme as standard, as ChromeContentClient does in the
  // engine. Otherwise the shell's origin is opaque and the refusals below
  // would pass for the wrong reason.
  url::ScopedSchemeRegistryForTests scheme_registry;
  url::AddStandardScheme(kDomicileScheme, url::SCHEME_WITH_HOST);

  const url::Origin shell = url::Origin::Create(GURL("domicile://shell/"));
  EXPECT_TRUE(ShellURLLoaderFactory::MayReadHome(shell, /*desk_locked=*/false));
  EXPECT_FALSE(ShellURLLoaderFactory::MayReadHome(
      url::Origin::Create(GURL("https://example.com/")), false));
  EXPECT_FALSE(ShellURLLoaderFactory::MayReadHome(
      url::Origin::Create(GURL("domicile://home/")), false));
  EXPECT_FALSE(ShellURLLoaderFactory::MayReadHome(std::nullopt, false));

  // A locked desk serves nothing from home, matching the compositor's rule for
  // `search_files` and `preview_file`.
  EXPECT_FALSE(ShellURLLoaderFactory::MayReadHome(shell, /*desk_locked=*/true));
}

TEST(ShellDocumentTest, DeclaresACharset) {
  EXPECT_NE(ShellURLLoaderFactory::ShellDocument("shell.js")
                .find("charset=\"utf-8\""),
            std::string::npos);
}

TEST(ShellDocumentTest, DeclaresAViewport) {
  // Without it, layout and compositor coordinates disagree by a scale factor.
  EXPECT_NE(ShellURLLoaderFactory::ShellDocument("shell.js")
                .find("width=device-width, initial-scale=1"),
            std::string::npos);
}

TEST(ShellDocumentTest, HasNoBodyMargin) {
  // A body margin would offset every window from where the compositor puts it.
  EXPECT_NE(ShellURLLoaderFactory::ShellDocument("shell.js").find("margin: 0"),
            std::string::npos);
}

TEST(ShellDocumentTest, NamesTheModuleItsShellIsIn) {
  // Blink's DomicileShell reads this element and runs the module.
  const std::string document = ShellURLLoaderFactory::ShellDocument("shell.js");
  EXPECT_NE(document.find("<meta content=\"./shell.js\" "
                          "name=\"domicile-shell-module\" />"),
            std::string::npos);
}

TEST(ShellDocumentTest, RunsNoScriptOfItsOwn) {
  // A page script could only reach the desktop through a global that every
  // script could read. The engine hands the desktop to the shell instead.
  const std::string document = ShellURLLoaderFactory::ShellDocument("shell.js");
  EXPECT_EQ(document.find("<script"), std::string::npos);
  EXPECT_EQ(document.find("navigator.domicile"), std::string::npos);
}

TEST(ShellDocumentTest, RunsScriptOnlyFromTheShellRoot) {
  // Markup injected through a notification body, window title or file name
  // must not run with the desktop.
  const network::mojom::URLResponseHeadPtr head =
      ShellURLLoaderFactory::ShellDocumentHead();
  ASSERT_TRUE(head->headers);
  EXPECT_EQ(head->headers->GetNormalizedHeader("Content-Security-Policy")
                .value_or(""),
            "script-src 'self'");
}

TEST(ShellDocumentTest, HandsTheShellAnEmptyBody) {
  // `mount-point.test.ts` uses the same empty body as a fixture.
  const std::string document = ShellURLLoaderFactory::ShellDocument("shell.js");
  EXPECT_NE(document.find("<body></body>"), std::string::npos);
}

TEST(ShellDocumentTest, EncodesTheModuleName) {
  // The name comes from disk; it must not be able to end the attribute.
  const std::string document =
      ShellURLLoaderFactory::ShellDocument("a\"><script>b.js");
  EXPECT_EQ(document.find("<script>b.js"), std::string::npos);
  EXPECT_EQ(document.find("a\""), std::string::npos);
}

TEST(ShellDocumentTest, NamesNothingAShellCouldCollideWith) {
  // Any id here is in the shell's namespace. `shell-manganese`'s `mountPoint`,
  // for example, looks up the id `domicile-shell`.
  const std::string document = ShellURLLoaderFactory::ShellDocument("shell.js");
  EXPECT_EQ(document.find("id="), std::string::npos);
}

TEST(ShellDocumentTest, LeavesAHashInAFilenameAlone) {
  // An unencoded `#` would start a fragment, so the browser would request
  // only the part before it.
  const std::string document = ShellURLLoaderFactory::ShellDocument("a#b.js");
  EXPECT_EQ(document.find("a#b.js"), std::string::npos);
  EXPECT_NE(document.find("a%23b.js"), std::string::npos);
}

}  // namespace
}  // namespace domicile
