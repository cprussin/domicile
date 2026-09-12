// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/shell_source.h"

#include <string>

#include "base/command_line.h"
#include "base/files/file_path.h"
#include "components/domicile/common/domicile_scheme.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// Three properties, and the third is the one this class exists for: what the
// browser serves can be replaced while it is running. The first two are the
// startup behaviour it must not change, because every desktop that works today
// relies on it -- the command line is still where a shell comes from, and an
// engine given no shell still holds nothing rather than a guess.

base::CommandLine WithShell(const std::string& root,
                            const std::string& module) {
  base::CommandLine command_line(base::CommandLine::NO_PROGRAM);
  command_line.AppendSwitchPath(kDomicileShellRootSwitch,
                                base::FilePath(root));
  command_line.AppendSwitchASCII(kDomicileShellModuleSwitch, module);
  return command_line;
}

TEST(ShellSourceTest, StartsOutWhereTheCommandLineSaid) {
  const ShellSource source(WithShell("/opt/domicile/shell", "shell.js"));
  EXPECT_EQ(source.Root(), base::FilePath("/opt/domicile/shell"));
  EXPECT_EQ(source.Module(), "shell.js");
}

TEST(ShellSourceTest, HoldsNothingWhenTheCommandLineSaidNothing) {
  // An engine started without either switch has no shell, and that is what it
  // must say: an empty root makes ShellURLLoaderFactory refuse everything and
  // an empty module makes it fail the document out loud. A default invented
  // here would turn both of those into a shell nobody asked for.
  const ShellSource source(base::CommandLine(base::CommandLine::NO_PROGRAM));
  EXPECT_TRUE(source.Root().empty());
  EXPECT_TRUE(source.Module().empty());
}

TEST(ShellSourceTest, TakesANewShellWholesale) {
  // Both at once, because a shell is a module *and* the directory it is served
  // out of -- `domicile load-shell ./other/dist/shell.js` changes both, and
  // replacing one without the other looks for the new name in the old tree.
  ShellSource source(WithShell("/opt/domicile/shell", "shell.js"));
  source.Set(base::FilePath("/home/someone/desktop/dist"), "desktop.js");
  EXPECT_EQ(source.Root(), base::FilePath("/home/someone/desktop/dist"));
  EXPECT_EQ(source.Module(), "desktop.js");
}

}  // namespace
}  // namespace domicile
