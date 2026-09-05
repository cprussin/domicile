// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_EXTERNAL_SURFACE_PROVIDER_H_
#define COMPONENTS_DOMICILE_BROWSER_EXTERNAL_SURFACE_PROVIDER_H_

#include "base/memory/raw_ptr.h"
#include "components/domicile/mojom/external_surface.mojom.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/common/surfaces/local_surface_id.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/receiver_set.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {

class FrameSinkBroker;

// The renderer's view of the broker, which is one method wide.
//
// This exists to be narrow. A FrameSinkBroker pipe is unrestricted authority to
// allocate frame sinks in the browser's own namespace, and a page must not hold
// that. What a page may do is say "I have allocated this LocalSurfaceId and
// will show this much of the surface" — which grants rather than takes, since
// the embed_token it mints is the capability the producer needs.
class ExternalSurfaceProvider : public mojom::ExternalSurfaceProvider {
 public:
  explicit ExternalSurfaceProvider(FrameSinkBroker* broker);

  ExternalSurfaceProvider(const ExternalSurfaceProvider&) = delete;
  ExternalSurfaceProvider& operator=(const ExternalSurfaceProvider&) = delete;

  ~ExternalSurfaceProvider() override;

  void Bind(mojo::PendingReceiver<mojom::ExternalSurfaceProvider> receiver);

  // mojom::ExternalSurfaceProvider implementation.
  void Embed(const viz::FrameSinkId& parent_frame_sink_id,
             const viz::LocalSurfaceId& local_surface_id,
             const gfx::Size& size,
             EmbedCallback callback) override;

 private:
  const raw_ptr<FrameSinkBroker> broker_;

  mojo::ReceiverSet<mojom::ExternalSurfaceProvider> receivers_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_EXTERNAL_SURFACE_PROVIDER_H_
