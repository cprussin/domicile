// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_PLATFORM_GRAPHICS_EXTERNAL_SURFACE_EMBEDDER_H_
#define THIRD_PARTY_BLINK_RENDERER_PLATFORM_GRAPHICS_EXTERNAL_SURFACE_EMBEDDER_H_

#include <optional>

#include "base/functional/callback.h"
#include "components/domicile/mojom/external_surface.mojom-blink.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/common/surfaces/local_surface_id.h"
#include "components/viz/common/surfaces/surface_id.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "third_party/blink/renderer/platform/platform_export.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"
#include "ui/gfx/geometry/size.h"

namespace blink {

// Resolves the SurfaceId of a surface the browser brokered to a non-renderer
// producer, so a layer in this page can embed it.
//
// The FrameSinkId comes from the browser: it is in the browser's namespace
// (client id 0), which blink.mojom.EmbeddedFrameSinkProvider rejects from a
// renderer. The LocalSurfaceId comes from this page, as the embedder: its
// embed_token lets the producer submit, and bumping its parent sequence number
// resizes the producer.
//
// Callers embed the result, e.g. via SurfaceLayerBridge.
class PLATFORM_EXPORT ExternalSurfaceEmbedder {
 public:
  // Null if the connection to the browser dropped before a producer turned up.
  using EmbeddedCallback =
      base::OnceCallback<void(const std::optional<viz::SurfaceId>&)>;

  // Which LocalSurfaceId to embed at.
  enum class Allocation {
    // The app's current LocalSurfaceId, allocating one if none exists.
    // Elements naming the same app share one surface; see the .cc for why
    // allocation is per app.
    kAdopt,
    // A new one with a bumped parent sequence number, so the producer
    // renders at the embedder's new size.
    kReconfigure,
  };

  ExternalSurfaceEmbedder();

  ExternalSurfaceEmbedder(const ExternalSurfaceEmbedder&) = delete;
  ExternalSurfaceEmbedder& operator=(const ExternalSurfaceEmbedder&) = delete;

  ~ExternalSurfaceEmbedder();

  // Resolves a LocalSurfaceId per `allocation` and asks the browser for the
  // FrameSinkId of `app_id`'s producer. `parent_frame_sink_id` is this page's,
  // so the producer joins its frame sink hierarchy and gets BeginFrames.
  // `size` is the size the producer renders at, and `scale` is the page's
  // device pixels per CSS pixel, which the producer uses to recover logical
  // size.
  //
  // The browser replies only once a producer for that app exists, since an
  // <app> element can exist before its window. The callback may never run.
  void Embed(const String& app_id,
             const viz::FrameSinkId& parent_frame_sink_id,
             const gfx::Size& size,
             double scale,
             Allocation allocation,
             EmbeddedCallback callback);

 private:
  void OnEmbedded(EmbeddedCallback callback,
                  const String& app_id,
                  const viz::LocalSurfaceId& local_surface_id,
                  const std::optional<viz::FrameSinkId>& frame_sink_id);

  mojo::Remote<domicile::mojom::blink::ExternalSurfaceProvider> provider_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_PLATFORM_GRAPHICS_EXTERNAL_SURFACE_EMBEDDER_H_
