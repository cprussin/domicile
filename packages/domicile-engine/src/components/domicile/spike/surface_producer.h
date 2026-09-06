// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_SPIKE_SURFACE_PRODUCER_H_
#define COMPONENTS_DOMICILE_SPIKE_SURFACE_PRODUCER_H_

#include <cstdint>
#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "base/time/time.h"
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "components/domicile/spike/mojom/spike_probe.mojom.h"
#include "components/viz/common/frame_sinks/begin_frame_args.h"
#include "components/viz/common/frame_timing_details_map.h"
#include "components/viz/common/quads/compositor_frame.h"
#include "components/viz/common/resources/returned_resource.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/common/surfaces/local_surface_id.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "mojo/public/cpp/platform/named_platform_channel.h"
#include "services/viz/public/mojom/compositing/compositor_frame_sink.mojom.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/geometry/size.h"

namespace domicile::spike {

// THROWAWAY. The spike's producer, standing in for domicile-compositor until it
// submits real buffers. See docs/architecture/ENGINE-FORK.md in the Domicile
// repository.
//
// A viz client in a process the browser did not launch, does not sandbox, and
// has no RenderProcessHost for. It joins the browser's mojo graph over a named
// socket, asks domicile::FrameSinkBroker for a frame sink, waits to be told
// which surface a page embedded it at, and submits solid-colour
// CompositorFrames to that surface until told another.
//
// Note what it does not do. It does not ask to be embedded, and it does not
// allocate a LocalSurfaceId: the embedder does both and this adopts what it is
// given. That is the direction RemoteFrame uses, and the direction a compositor
// telling a client to resize has to run in.
//
// What each of the spike's steps asserts about the result is the caller's:
// step 3's is one pixel at the centre of the window, step 4's is a diff of an
// <app> against an ordinary element beside it.
class SurfaceProducer : public viz::mojom::CompositorFrameSinkClient,
                        public mojom::SurfaceObserver {
 public:
  // An embedder has told us which surface to render at, and how much of it it
  // will show. Fires again every time the embedder's box changes, which is
  // this half of xdg_toplevel.configure.
  using EmbeddedCallback =
      base::RepeatingCallback<void(const viz::LocalSurfaceId&,
                                   const gfx::Size&)>;
  // The browser went away, and nothing this produces can be believed after it.
  using LostCallback = base::OnceCallback<void(const std::string& why)>;

  SurfaceProducer(SkColor color,
                  EmbeddedCallback on_embedded,
                  LostCallback on_lost);

  SurfaceProducer(const SurfaceProducer&) = delete;
  SurfaceProducer& operator=(const SurfaceProducer&) = delete;

  ~SurfaceProducer() override;

  // Joins the browser's mojo graph and takes the broker and probe pipes off the
  // invitation.
  //
  // This is a real invitation over a named socket rather than a
  // mojo::IsolatedConnection, and that is forced rather than chosen: the broker
  // forwards our CompositorFrameSink receiver on to the viz process, and an
  // isolated connection's own header says a handle it carries "cannot [be
  // passed] to yet another process". See ENGINE-FORK.md, "How the producer
  // reaches the broker".
  bool Connect(const mojo::NamedPlatformChannel::ServerName& socket);

  // Asks the broker for a frame sink and runs `on_brokered` with the id it
  // allocated. Nothing is submitted until an embedder names a surface, which
  // may be before or after this and needs no ordering.
  using BrokeredCallback = base::OnceCallback<void(const viz::FrameSinkId&)>;
  void Start(BrokeredCallback on_brokered);

  // The colour every frame from now on is filled with, submitted at once so
  // that a caller timing "submitted" against "drawn" has a submit to time from.
  // Does nothing before an embedder has named a surface.
  void SetColor(SkColor color);

  SkColor color() const { return color_; }
  const viz::FrameSinkId& frame_sink_id() const { return frame_sink_id_; }
  const gfx::Size& size() const { return size_; }
  bool embedded() const { return submitting_; }
  int frames_submitted() const { return frames_submitted_; }
  int begin_frames_seen() const { return begin_frames_seen_; }

  // The display's frame interval, as viz last told us in a BeginFrameArgs.
  // Zero until a BeginFrame has arrived. This is the unit any "how long did it
  // take to appear" number is really in, and taking it from viz beats
  // inferring it from the numbers being measured.
  base::TimeDelta frame_interval() const { return frame_interval_; }

  // The browser's answer to "what did viz actually draw". Valid after Connect.
  mojom::SpikeProbe* probe() { return probe_.get(); }

 private:
  // mojom::SurfaceObserver:
  void OnSurfaceEmbedded(const viz::LocalSurfaceId& local_surface_id,
                         const gfx::Size& size) override;
  // Never sent to this producer, and could not be acted on if it were: it
  // holds its own CompositorFrameSink, so it is viz's client and hears
  // BeginFrames directly, and it submits solid colours rather than importing
  // buffers. Both are for a producer whose sink the browser owns — the engine
  // library — which is why they are empty here rather than absent.
  void OnFrame(int64_t deadline_us) override;
  void OnBufferReleased(uint64_t buffer_id) override;

  // viz::mojom::CompositorFrameSinkClient:
  void DidReceiveCompositorFrameAck(
      std::vector<viz::ReturnedResource> resources) override;
  void OnBeginFrame(const viz::BeginFrameArgs& args,
                    const viz::FrameTimingDetailsMap& timing_details,
                    std::vector<viz::ReturnedResource> resources) override;
  void OnBeginFramePausedChanged(bool paused) override;
  void ReclaimResources(std::vector<viz::ReturnedResource> resources) override;
  void OnCompositorFrameTransitionDirectiveProcessed(
      uint32_t sequence_id) override;
  void OnSurfaceEvicted(const viz::LocalSurfaceId& local_surface_id) override;

  void OnFrameSinkCreated(BrokeredCallback on_brokered,
                          const viz::FrameSinkId& frame_sink_id);
  void OnBrokerDisconnected();
  void Submit(const viz::BeginFrameAck& ack);

  SkColor color_;
  EmbeddedCallback on_embedded_;
  LostCallback on_lost_;

  mojo::Remote<mojom::FrameSinkBroker> broker_;
  mojo::Remote<mojom::SpikeProbe> probe_;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink_;
  mojo::Receiver<viz::mojom::CompositorFrameSinkClient> client_receiver_{this};
  mojo::Receiver<mojom::SurfaceObserver> observer_receiver_{this};

  viz::FrameSinkId frame_sink_id_;
  viz::LocalSurfaceId local_surface_id_;
  gfx::Size size_;
  viz::FrameTokenGenerator next_frame_token_;
  bool submitting_ = false;
  int frames_submitted_ = 0;
  int begin_frames_seen_ = 0;
  base::TimeDelta frame_interval_;
};

}  // namespace domicile::spike

#endif  // COMPONENTS_DOMICILE_SPIKE_SURFACE_PRODUCER_H_
