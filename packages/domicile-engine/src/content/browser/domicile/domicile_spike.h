// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_SPIKE_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_SPIKE_H_

#include "content/common/content_export.h"

namespace content {

// THROWAWAY. Step 2 of the spike in docs/architecture/ENGINE-FORK.md.
//
// If --domicile-broker-socket=<path> was passed, opens a NamedPlatformChannel
// there and sends a real mojo invitation over it, carrying the
// domicile::FrameSinkBroker from step 1 and a stand-in embedder. Does nothing
// otherwise, which is why one call site in browser_main_loop.cc is the whole
// cost of carrying this.
//
// The socket path is the access control. Holding a FrameSinkBroker pipe is
// unrestricted authority to allocate frame sinks in viz, so whoever can open
// the path can do that, and nobody else can: the invitation is not something a
// renderer can be handed, and the connection is accepted once.
//
// Must be called on the UI thread, after the compositor exists.
CONTENT_EXPORT void MaybeStartDomicileSpike();

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_SPIKE_H_
