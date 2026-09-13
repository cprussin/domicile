// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_SHELL_SOURCE_H_
#define COMPONENTS_DOMICILE_BROWSER_SHELL_SOURCE_H_

#include <string>

#include "base/files/file_path.h"

namespace base {
class CommandLine;
}  // namespace base

namespace domicile {

// Which shell this browser serves: the directory its files are read out of, and
// the module inside it that a shell is.
//
// WHY THIS IS NOT THE COMMAND LINE, WHICH IS WHERE IT USED TO BE READ FROM.
// `--domicile-shell-root` and `--domicile-shell-module` are how a shell arrives
// at a fresh engine and they stay that way -- this is seeded from them. What
// they cannot be is *changed*: a process's command line is fixed from outside
// it, so an engine told once at launch could never be told again, and
// `domicile load-shell <path>` had nowhere to land. See
// docs/architecture/THE-DOMICILE-BINARY.md, "The engine's half, which is in".
//
// RESTARTING THE ENGINE IS NOT THE ALTERNATIVE IT LOOKS LIKE. The browser
// process holds the broker socket the compositor produces its windows into, so
// a restart to pick up a new command line is a restart that closes every
// window on the desktop. Switching the shell has to happen in a process that
// keeps running, which is what makes this mutable rather than another switch.
//
// BOTH HALVES MOVE TOGETHER. A shell is one module and the directory it is
// served out of; `Set` takes the pair because a new module name resolved
// against the old root is a 404 and an old name against a new root is the
// wrong desktop.
//
// ONE SEQUENCE. This is read where the shell's URLLoaderFactory is built and
// asked, which is the UI thread, and it is meant to be written from there too
// -- applying a new shell navigates the shell's window, and navigation is the
// UI thread's. Whatever carries a `load-shell` in off a socket posts here
// rather than writing from the socket's sequence; there is no lock, and the
// hop is the reason there does not need to be one.
class ShellSource {
 public:
  // The process's one shell source, seeded the first time it is asked for from
  // the command line this browser was started with. Tests build their own on
  // the stack instead.
  static ShellSource& Get();

  explicit ShellSource(const base::CommandLine& command_line);

  ShellSource(const ShellSource&) = delete;
  ShellSource& operator=(const ShellSource&) = delete;

  ~ShellSource();

  // Where the shell's files are read from. Empty when the engine was given no
  // `--domicile-shell-root` and nothing has set one since, which is what makes
  // ShellURLLoaderFactory refuse every request rather than guess a directory.
  base::FilePath Root() const;

  // The module a shell is, as a name under `Root()`. Empty for the same reason,
  // and the document the engine writes fails out loud on it.
  std::string Module() const;

  // Serve this shell from now on. Takes effect on the next request for
  // `domicile://shell/`, which is to say on the next time the shell's window is
  // navigated or reloaded -- setting this does not itself move the window.
  void Set(const base::FilePath& root, const std::string& module);

 private:
  base::FilePath root_;
  std::string module_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SHELL_SOURCE_H_
