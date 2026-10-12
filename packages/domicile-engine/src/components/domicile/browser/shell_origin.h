// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SHELL_ORIGIN_H_
#define COMPONENTS_DOMICILE_BROWSER_SHELL_ORIGIN_H_

namespace url {
class Origin;
}

namespace domicile {

// Whether `origin` is the shell's, `domicile://shell`.
//
// Gates what only the shell may do, such as embed a client's window. Web
// content cannot hold this origin: see docs/architecture/DOMICILE-SCHEME.md.
bool IsShellOrigin(const url::Origin& origin);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SHELL_ORIGIN_H_
