// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_

#include "components/domicile/mojom/external_surface.mojom.h"
#include "content/common/content_export.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

namespace content {

class RenderFrameHost;

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

// Binds `frame` to the browser's domicile::FrameSinkBroker, if it is the shell.
//
// Any other frame asking is a bad message: a page that embeds a window takes
// that window's pixels from the shell. An embed under a parent frame sink
// outside the frame's renderer is a bad message too.
//
// Registered as a frame binder, so call on the UI thread.
CONTENT_EXPORT void BindDomicileExternalSurfaceProvider(
    RenderFrameHost* frame,
    mojo::PendingReceiver<domicile::mojom::ExternalSurfaceProvider> receiver);

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_
