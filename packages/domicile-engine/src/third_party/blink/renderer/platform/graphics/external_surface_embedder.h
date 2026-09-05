// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_PLATFORM_GRAPHICS_EXTERNAL_SURFACE_EMBEDDER_H_
#define THIRD_PARTY_BLINK_RENDERER_PLATFORM_GRAPHICS_EXTERNAL_SURFACE_EMBEDDER_H_

#include <optional>

#include "base/functional/callback.h"
#include "components/domicile/mojom/external_surface.mojom-blink.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/common/surfaces/local_surface_id.h"
#include "components/viz/common/surfaces/parent_local_surface_id_allocator.h"
#include "components/viz/common/surfaces/surface_id.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "third_party/blink/renderer/platform/platform_export.h"
#include "ui/gfx/geometry/size.h"

namespace blink {

// Resolves the SurfaceId of a surface the browser brokered to a producer that
// is not a renderer, so a layer in this page can embed it.
//
// The two halves of that SurfaceId come from opposite sides, and neither side
// could supply the other's. The FrameSinkId is the browser's, because a
// brokered id is in the browser's own namespace — client id 0 — and every entry
// point of blink.mojom.EmbeddedFrameSinkProvider rejects a FrameSinkId whose
// client id is not this renderer's. So the renderer's ordinary allocation path
// cannot name one, and the id arrives from the browser the way RemoteFrame's
// does. The LocalSurfaceId is this page's, because the page is the embedder:
// the embed_token in it is the capability the producer needs in order to
// submit, and bumping its parent_sequence_number is how an embedder resizes a
// producer.
//
// This does not embed anything itself. It hands back a SurfaceId, and what a
// caller does with it — cc::SurfaceLayer::SetSurfaceId, by way of
// SurfaceLayerBridge — is the caller's business.
class PLATFORM_EXPORT ExternalSurfaceEmbedder {
 public:
  // Null if the connection to the browser dropped before a producer turned up.
  using EmbeddedCallback =
      base::OnceCallback<void(const std::optional<viz::SurfaceId>&)>;

  ExternalSurfaceEmbedder();

  ExternalSurfaceEmbedder(const ExternalSurfaceEmbedder&) = delete;
  ExternalSurfaceEmbedder& operator=(const ExternalSurfaceEmbedder&) = delete;

  ~ExternalSurfaceEmbedder();

  // Allocates a LocalSurfaceId and asks the browser which FrameSinkId to pair
  // it with. `parent_frame_sink_id` is this page's own, so that the producer
  // ends up under it in the frame sink hierarchy and BeginFrames reach it.
  //
  // The browser holds the reply until some producer has been brokered a sink,
  // because an <app> element exists before the window behind it does. So this
  // may take arbitrarily long, and if no producer ever connects it never runs.
  void Embed(const viz::FrameSinkId& parent_frame_sink_id,
             const gfx::Size& size,
             EmbeddedCallback callback);

 private:
  void OnEmbedded(EmbeddedCallback callback,
                  const viz::LocalSurfaceId& local_surface_id,
                  const std::optional<viz::FrameSinkId>& frame_sink_id);

  viz::ParentLocalSurfaceIdAllocator local_surface_id_allocator_;
  mojo::Remote<domicile::mojom::blink::ExternalSurfaceProvider> provider_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_PLATFORM_GRAPHICS_EXTERNAL_SURFACE_EMBEDDER_H_
