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

// The only host under it. `domicile://shell/index.html` is the shell's
// document; there is no second host, and naming one is how a request for
// something that is not the shell is refused.
inline constexpr char kDomicileShellHost[] = "shell";

// What `domicile://shell/` resolves to when no file is named.
inline constexpr char kDomicileShellIndex[] = "index.html";

// Where the shell's files are read from. Same shape as
// --domicile-broker-socket: the engine already takes what it needs on its
// command line.
inline constexpr char kDomicileShellRootSwitch[] = "domicile-shell-root";

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_DOMICILE_SCHEME_H_
