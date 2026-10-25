// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_CAST_SINKS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_CAST_SINKS_H_

#include "components/domicile/mojom/cast_sinks.mojom.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

namespace content {
class RenderFrameHost;
}  // namespace content

namespace domicile {

// Binds CastSinks for `frame`: the Google Cast receivers the profile's Media
// Router finds, and casts of the desktop to them. See
// components/domicile/mojom/cast_sinks.mojom.
//
// This function does no access control. PopulateChromeFrameBinders registers
// it only for the shell's origin.
void BindCastSinks(content::RenderFrameHost* frame,
                   mojo::PendingReceiver<mojom::CastSinks> receiver);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_CAST_SINKS_H_
