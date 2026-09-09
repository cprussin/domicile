// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_

#include "components/domicile/mojom/external_surface.mojom.h"
#include "content/common/content_export.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

namespace content {

// Builds the browser's broker, and opens the producer's socket if
// --domicile-broker-socket names one. Without that switch it builds an object
// that binds nothing and listens on nothing.
//
// A DESKTOP CANNOT BOOT WITHOUT THIS, and that is what it is for. Lazily on
// first embed was right for a page that embeds when it loads, which every
// spike page does. A shell does not: it mounts an <app> element when the host
// announces a window, the host learns of windows from the compositor, and the
// compositor is the producer that connects over this socket. So the socket
// waited for an embed, the embed for a window, and the window for the socket.
// guard-shell.sh found that deadlock by being the first thing to drive a real
// shell.
//
// Which makes the socket's existence a statement about the browser having been
// asked for one, rather than about any page having embedded.
//
// Must be called on the UI thread, once the ImageTransportFactory is up —
// GetHostFrameSinkManager() reads through it.
CONTENT_EXPORT void StartDomicileFrameSinkBroker();

// Binds a page to the browser's one domicile::FrameSinkBroker.
//
// This is the whole of what content contributes. The two things the broker
// needs, the HostFrameSinkManager and the allocator that owns the browser's
// FrameSinkId namespace, are CONTENT_EXPORT free functions in
// content/browser/compositor/surface_utils.h, so nothing here reaches into an
// object graph a non-renderer producer cannot be given access to.
//
// The broker itself is built at startup — see StartDomicileFrameSinkBroker
// above — so by the time a page asks, there is one waiting.
//
// Must be called on the UI thread, after the compositor is up.
CONTENT_EXPORT void BindDomicileExternalSurfaceProvider(
    mojo::PendingReceiver<domicile::mojom::ExternalSurfaceProvider> receiver);

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_
