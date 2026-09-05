// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_

#include "components/domicile/mojom/external_surface.mojom.h"
#include "content/common/content_export.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

namespace content {

// Binds a page to the browser's one domicile::FrameSinkBroker, creating it —
// and the socket a producer reaches it over — on first use.
//
// This is the whole of what content contributes. The two things the broker
// needs, the HostFrameSinkManager and the allocator that owns the browser's
// FrameSinkId namespace, are CONTENT_EXPORT free functions in
// content/browser/compositor/surface_utils.h, so nothing here reaches into an
// object graph a non-renderer producer cannot be given access to.
//
// First use is a page calling canvas.embedExternalSurface(), which is why there
// is no startup hook: an <app> element exists before the window behind it does,
// and the broker's Embed() holds the page's request until a producer connects.
// Nothing is created, and no socket is opened, in a browser whose pages never
// ask.
//
// Must be called on the UI thread, after the compositor is up.
CONTENT_EXPORT void BindDomicileExternalSurfaceProvider(
    mojo::PendingReceiver<domicile::mojom::ExternalSurfaceProvider> receiver);

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_
