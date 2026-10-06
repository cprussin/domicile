// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shell_source.h"

#include <string>

#include "base/command_line.h"
#include "base/files/file_path.h"
#include "components/domicile/common/domicile_scheme.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// The command line seeds the shell, no command line means no shell, and Set
// replaces the shell at runtime.

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
  // No default shell: empty values make ShellURLLoaderFactory fail visibly.
  // Braces avoid the most vexing parse: with parentheses this declares a
  // function.
  const ShellSource source{base::CommandLine(base::CommandLine::NO_PROGRAM)};
  EXPECT_TRUE(source.Root().empty());
  EXPECT_TRUE(source.Module().empty());
}

TEST(ShellSourceTest, TakesANewShellWholesale) {
  // `domicile load-shell` changes both the root and the module.
  ShellSource source(WithShell("/opt/domicile/shell", "shell.js"));
  source.Set(base::FilePath("/home/someone/desktop/dist"), "desktop.js");
  EXPECT_EQ(source.Root(), base::FilePath("/home/someone/desktop/dist"));
  EXPECT_EQ(source.Module(), "desktop.js");
}

}  // namespace
}  // namespace domicile
