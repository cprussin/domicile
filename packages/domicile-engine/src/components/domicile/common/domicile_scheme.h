// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_COMMON_DOMICILE_SCHEME_H_
#define COMPONENTS_DOMICILE_COMMON_DOMICILE_SCHEME_H_

namespace domicile {

// The scheme a Domicile shell is served over.
//
// It exists so that the shell has a real origin without a TCP port. A shell is
// a page inside this Chromium, and for its JavaScript to have an origin at all
// it needs a URL with one -- file: has none, so no WebSocket and a restricted
// fetch. The answer had been an HTTP server on a loopback port, and a loopback
// port is reachable by every process on the machine. See
// docs/architecture/ENGINE-FORK.md, "The page is served over a TCP port, and it
// should not be".
//
// Registered as a *standard* scheme, so it has an origin, and deliberately
// neither web-safe nor CORS-enabled, so ordinary web content can neither
// navigate to it nor fetch it.
inline constexpr char kDomicileScheme[] = "domicile";

// The only host under it. `domicile://shell/` is the shell's document -- the
// bare root, which `ShellURLLoaderFactory` answers with the page it writes,
// and not a file on disk. This said `index.html` and the launcher believed it,
// asked for that path, and got the file resolver looking for a file no build
// emits; the desktop came up on an empty window. There is no second host, and
// naming one is how a request for something that is not the shell is refused.
inline constexpr char kDomicileShellHost[] = "shell";

// Where the shell's files are read from. Same shape as
// --domicile-broker-socket: the engine already takes what it needs on its
// command line.
inline constexpr char kDomicileShellRootSwitch[] = "domicile-shell-root";

// The compositor's control socket -- its --chrome-socket. A unix stream
// carrying newline-delimited JSON, which is the protocol the deleted WebSocket
// bridge carried byte for byte.
inline constexpr char kDomicileControlSocketSwitch[] =
    "domicile-control-socket";

// The shell itself: one JavaScript module, a path and nothing else. There is no
// manifest and there is not going to be one -- everything a manifest could
// carry is an export the shell hands over once it is running, and the one
// category that could not be (something Domicile must know *before* running the
// code) is empty, because Domicile gates nothing.
inline constexpr char kDomicileShellModuleSwitch[] = "domicile-shell-module";

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_DOMICILE_SCHEME_H_
