// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_HIDDEN_FROM_CAPTURES_ID_H_
#define COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_HIDDEN_FROM_CAPTURES_ID_H_

#include "base/token.h"

namespace viz::domicile {

// The restriction target id every element of the shell's gets from
// `RestrictionTarget.fromElement`: the one captures of the desk leave out.
// As the page sees it, a GUID ...
inline constexpr char kHiddenFromCapturesGuid[] =
    "646f6d69-6369-6c65-6869-6464656e2121";

// ... and as viz sees it, a render pass's `subtree_capture_id`: the GUID's
// first and last sixteen hex digits. "domicile" and "hidden!!" in ASCII.
inline constexpr base::Token kHiddenFromCaptures(0x646f6d6963696c65u,
                                                 0x68696464656e2121u);

}  // namespace viz::domicile

#endif  // COMPONENTS_VIZ_SERVICE_DISPLAY_DOMICILE_HIDDEN_FROM_CAPTURES_ID_H_
