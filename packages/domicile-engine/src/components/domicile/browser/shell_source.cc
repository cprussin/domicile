// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/shell_source.h"

#include <string>

#include "base/command_line.h"
#include "base/files/file_path.h"
#include "base/no_destructor.h"
#include "components/domicile/common/domicile_scheme.h"

namespace domicile {

// static
ShellSource& ShellSource::Get() {
  static base::NoDestructor<ShellSource> source(
      *base::CommandLine::ForCurrentProcess());
  return *source;
}

ShellSource::ShellSource(const base::CommandLine& command_line)
    : root_(command_line.GetSwitchValuePath(kDomicileShellRootSwitch)),
      module_(command_line.GetSwitchValueASCII(kDomicileShellModuleSwitch)) {}

ShellSource::~ShellSource() = default;

base::FilePath ShellSource::Root() const {
  return root_;
}

std::string ShellSource::Module() const {
  return module_;
}

void ShellSource::Set(const base::FilePath& root, const std::string& module) {
  root_ = root;
  module_ = module;
}

}  // namespace domicile
