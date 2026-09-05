// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_

#include "components/domicile/browser/frame_sink_broker.h"
#include "content/common/content_export.h"

namespace content {

// The browser process's one domicile::FrameSinkBroker, created on first use.
//
// This is the whole of what content contributes: the two things the broker
// needs — the HostFrameSinkManager and the allocator that owns the browser's
// FrameSinkId namespace — are CONTENT_EXPORT free functions in
// content/browser/compositor/surface_utils.h, so nothing here reaches into an
// object graph a non-renderer producer cannot be given access to.
//
// Must be called on the UI thread, after the compositor is up.
CONTENT_EXPORT domicile::FrameSinkBroker& GetDomicileFrameSinkBroker();

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_FRAME_SINK_BROKER_H_
