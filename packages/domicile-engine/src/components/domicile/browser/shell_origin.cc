// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shell_origin.h"

#include "components/domicile/common/domicile_scheme.h"
#include "url/origin.h"

namespace domicile {

bool IsShellOrigin(const url::Origin& origin) {
  return origin.scheme() == kDomicileScheme &&
         origin.host() == kDomicileShellHost;
}

}  // namespace domicile
