// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_COMMON_DOMICILE_SCHEME_H_
#define COMPONENTS_DOMICILE_COMMON_DOMICILE_SCHEME_H_

namespace domicile {

// The scheme a Domicile shell is served over.
//
// Gives the shell a real origin without a TCP port, which any local process
// could reach. See docs/architecture/DOMICILE-SCHEME.md.
//
// Registered as a standard scheme so it has an origin, but neither web-safe
// nor CORS-enabled, so web content can neither navigate to it nor fetch it.
inline constexpr char kDomicileScheme[] = "domicile";

// The shell's host. The bare root `domicile://shell/` is a page that
// `ShellURLLoaderFactory` generates, not a file on disk. Requests to hosts
// other than this and `kDomicileHomeHost` are refused.
inline constexpr char kDomicileShellHost[] = "shell";

// The user's home, for shell previews: `domicile://home/Notes/a.png` is
// `$HOME/Notes/a.png`. Served only to the shell's own document (see
// ShellURLLoaderFactory) and never for paths containing a dotfile.
inline constexpr char kDomicileHomeHost[] = "home";

// Directory the shell's files are read from.
inline constexpr char kDomicileShellRootSwitch[] = "domicile-shell-root";

// The compositor's control socket (its --chrome-socket): a unix stream of
// newline-delimited JSON.
inline constexpr char kDomicileControlSocketSwitch[] =
    "domicile-control-socket";

// The engine's command socket: a unix stream the engine binds and the
// supervisor dials, one line of JSON in and one out. See
// `components/domicile/browser/command_protocol.h`.
//
// It talks to the supervisor, not the compositor, because the page never uses
// these messages. Absent unless `domicile load-shell` started the engine.
inline constexpr char kDomicileCommandSocketSwitch[] =
    "domicile-command-socket";

// Path to the shell's JavaScript module. There is no manifest: the shell
// provides everything through its exports once running.
inline constexpr char kDomicileShellModuleSwitch[] = "domicile-shell-module";

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_DOMICILE_SCHEME_H_
