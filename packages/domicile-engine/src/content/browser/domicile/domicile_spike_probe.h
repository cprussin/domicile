// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_SPIKE_PROBE_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_SPIKE_PROBE_H_

#include "components/domicile/spike/mojom/spike_probe.mojom.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

namespace content {

// THROWAWAY. The spike's proof: see components/domicile/spike/mojom.
//
// The producer holds the other end and compares what viz drew with what it
// submitted. Nothing in the design needs this, and nothing but the spike binds
// it.
void BindDomicileSpikeProbe(
    mojo::PendingReceiver<domicile::mojom::SpikeProbe> receiver);

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_SPIKE_PROBE_H_
