// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_SHADER_EFFECTS_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_SHADER_EFFECTS_H_

#include "components/domicile/mojom/shader_effects.mojom.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

namespace content {

class RenderFrameHost;

// Binds `frame`'s shader effects, if it is the shell. Its effects draw only
// in its own widget's frames, and go when its document does.
//
// Any other frame asking is a bad message: only the shell runs SkSL in the
// GPU process. See docs/architecture/MOTION.md#security.
//
// Registered as a frame binder, so call on the UI thread.
void BindDomicileShaderEffects(
    RenderFrameHost* frame,
    mojo::PendingReceiver<domicile::mojom::ShaderEffects> receiver);

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_SHADER_EFFECTS_H_
