// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_

#include "components/domicile/mojom/external_surface.mojom.h"
#include "content/common/content_export.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

namespace content {

// Builds the browser's broker and, if --domicile-broker-socket names a path,
// listens on it. Without the switch it does nothing.
//
// Runs at startup rather than on first embed. A shell embeds only after the
// compositor reports a window, and the compositor connects over this socket, so
// waiting for an embed would deadlock.
//
// Call on the UI thread, after the ImageTransportFactory is up;
// GetHostFrameSinkManager() reads through it.
CONTENT_EXPORT void StartDomicileFrameSinkBroker();

// Binds a page to the browser's domicile::FrameSinkBroker.
//
// Call on the UI thread, after the compositor is up.
CONTENT_EXPORT void BindDomicileExternalSurfaceProvider(
    mojo::PendingReceiver<domicile::mojom::ExternalSurfaceProvider> receiver);

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_
