// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_SPIKE_PROBE_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_SPIKE_PROBE_H_

#include "components/domicile/spike/mojom/spike_probe.mojom.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

namespace content {

// Binds the spike's test probe. See components/domicile/spike/mojom.
//
// Temporary and used only by the spike. The producer holds the other end and
// compares what viz drew with what it submitted.
void BindDomicileSpikeProbe(
    mojo::PendingReceiver<domicile::mojom::SpikeProbe> receiver);

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_SPIKE_PROBE_H_
