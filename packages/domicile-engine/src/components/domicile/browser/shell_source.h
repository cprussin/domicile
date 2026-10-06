// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SHELL_SOURCE_H_
#define COMPONENTS_DOMICILE_BROWSER_SHELL_SOURCE_H_

#include <string>

#include "base/files/file_path.h"

namespace base {
class CommandLine;
}  // namespace base

namespace domicile {

// The shell this browser serves: its root directory and module.
//
// Seeded from `--domicile-shell-root` and `--domicile-shell-module`, and
// mutable so `domicile load-shell` can switch shells without restarting the
// engine, which would close every window. See
// docs/architecture/THE-DOMICILE-BINARY.md#the-engine-command-socket.
//
// Not thread-safe: read and write it only on the UI thread.
class ShellSource {
 public:
  // The process-wide instance, seeded from the command line on first use.
  static ShellSource& Get();

  explicit ShellSource(const base::CommandLine& command_line);

  ShellSource(const ShellSource&) = delete;
  ShellSource& operator=(const ShellSource&) = delete;

  ~ShellSource();

  // The directory the shell's files are read from. Empty if never set, which
  // makes ShellURLLoaderFactory refuse every request.
  base::FilePath Root() const;

  // The shell's module, relative to `Root()`. Empty if never set, which makes
  // the shell document fail with an error.
  std::string Module() const;

  // Replaces the shell. Set both together: a module only makes sense with its
  // root. Takes effect on the next navigation or reload of the shell's window.
  void Set(const base::FilePath& root, const std::string& module);

 private:
  base::FilePath root_;
  std::string module_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SHELL_SOURCE_H_
