// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shell_death.h"

#include <string>

#include "base/process/kill.h"
#include "components/domicile/common/domicile_scheme.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"
#include "url/url_util.h"

namespace domicile {
namespace {

class ShellDeathTest : public testing::Test {
 protected:
  // Registered as the engine does, so domicile:// URLs have a host.
  ShellDeathTest() {
    url::AddStandardScheme(kDomicileScheme, url::SCHEME_WITH_HOST);
  }

 private:
  url::ScopedSchemeRegistryForTests scheme_registry_;
};

TEST_F(ShellDeathTest, TheShellsPageIsAnyPathOnTheShellsHost) {
  EXPECT_TRUE(IsTheShellsPage(GURL("domicile://shell/")));
  EXPECT_TRUE(IsTheShellsPage(GURL("domicile://shell/?splash=1")));
  EXPECT_TRUE(IsTheShellsPage(GURL("domicile://shell/panel.html")));
}

TEST_F(ShellDeathTest, NoOtherPageIsTheShells) {
  EXPECT_FALSE(IsTheShellsPage(GURL("https://example.com/")));
  EXPECT_FALSE(IsTheShellsPage(
      GURL("domicile://app-3f34b27d8967e876d882c16c62df92be/")));
  EXPECT_FALSE(IsTheShellsPage(GURL("https://shell/")));
  EXPECT_FALSE(IsTheShellsPage(GURL()));
}

TEST_F(ShellDeathTest, TheMessageSaysItIsABugAndWhyTheRendererWent) {
  const std::string message = ShellDeathMessage(
      GURL("domicile://shell/"), base::TERMINATION_STATUS_PROCESS_CRASHED, 139);
  EXPECT_NE(message.find("the Domicile shell's renderer died"),
            std::string::npos)
      << message;
  EXPECT_NE(message.find("(crashed, exit code 139)"), std::string::npos)
      << message;
  EXPECT_NE(message.find("This is a bug in Domicile"), std::string::npos)
      << message;
  EXPECT_NE(message.find("domicile://shell/"), std::string::npos) << message;
}

TEST_F(ShellDeathTest, TheEngineDiesWithTheShell) {
  EXPECT_DEATH_IF_SUPPORTED(
      DieIfTheShellDied(GURL("domicile://shell/"),
                        base::TERMINATION_STATUS_OOM, 0),
      "the Domicile shell's renderer died \\(oom, exit code 0\\)");
}

TEST_F(ShellDeathTest, AnyOtherPageLeftItsRendererToChrome) {
  // Each returns: a web page that dies is the sad tab's, or the <webview>'s.
  DieIfTheShellDied(GURL("https://example.com/"),
                    base::TERMINATION_STATUS_PROCESS_CRASHED, 139);
  DieIfTheShellDied(GURL("domicile://app-3f34b27d8967e876d882c16c62df92be/"),
                    base::TERMINATION_STATUS_PROCESS_WAS_KILLED, 9);
}

}  // namespace
}  // namespace domicile
