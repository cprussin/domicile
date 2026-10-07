// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_FRAME_SINK_BROKER_H_
#define COMPONENTS_DOMICILE_BROWSER_FRAME_SINK_BROKER_H_

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "components/domicile/browser/brokered_frame_sink.h"
#include "components/domicile/browser/display_capture.h"
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/common/surfaces/local_surface_id.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver_set.h"
#include "mojo/public/cpp/bindings/remote_set.h"
#include "ui/gfx/geometry/size.h"

namespace viz {
class HostFrameSinkManager;
}

namespace domicile {

// Brokers viz frame sinks to a non-renderer producer (the compositor) and
// connects each one to the page that embeds it.
//
// The renderer equivalent, content::EmbeddedFrameSinkProviderImpl, validates
// that a FrameSinkId is in the caller's namespace. A producer outside the
// process tree has no namespace, so this allocates ids itself with
// `allocate_frame_sink_id`. That must be the browser's own allocator, or ids
// collide.
//
// Pages do not get this interface: it can allocate any frame sink. They use
// mojom::ExternalSurfaceProvider instead.
class FrameSinkBroker : public mojom::FrameSinkBroker {
 public:
  using FrameSinkIdAllocator = base::RepeatingCallback<viz::FrameSinkId()>;
  using SharedImageInterfaceGetter =
      BrokeredFrameSink::SharedImageInterfaceGetter;
  using EmbedCallback =
      base::OnceCallback<void(const std::optional<viz::FrameSinkId>&)>;
  // Applies the producer's display layout to the connectors. Injected because
  // this target does not depend on //ui/ozone or //content. Empty when the
  // embedder has no CRTC (anything but a tty); the layout is then dropped.
  using DisplayLayoutSetter =
      base::RepeatingCallback<void(std::vector<mojom::DisplayLayoutPtr>)>;
  // Writes the producer's clipboard into `ui::OzonePlatform`'s clipboard.
  // Injected for the same reason. Empty when the embedder runs inside another
  // session; the text is then dropped.
  using ClipboardSetter =
      base::RepeatingCallback<void(mojom::Clipboard, const std::string&)>;
  // The root frame sink of the browser window showing a display, or nullopt
  // when none does. Injected because finding windows needs //ui/aura. Empty
  // when the embedder has no windows to capture; every capture is then
  // refused.
  using DisplayCaptureTargetGetter =
      base::RepeatingCallback<std::optional<viz::FrameSinkId>(int64_t)>;

  // `get_shared_image_interface` gives imported dmabufs a GPU. Injected because
  // this target does not depend on //ui/aura. It returns null when headless.
  FrameSinkBroker(
      viz::HostFrameSinkManager* host_frame_sink_manager,
      FrameSinkIdAllocator allocate_frame_sink_id,
      SharedImageInterfaceGetter get_shared_image_interface =
          SharedImageInterfaceGetter(),
      DisplayLayoutSetter set_display_layout = DisplayLayoutSetter(),
      ClipboardSetter set_clipboard = ClipboardSetter(),
      DisplayCaptureTargetGetter get_display_capture_target =
          DisplayCaptureTargetGetter());

  FrameSinkBroker(const FrameSinkBroker&) = delete;
  FrameSinkBroker& operator=(const FrameSinkBroker&) = delete;

  ~FrameSinkBroker() override;

  void Bind(mojo::PendingReceiver<mojom::FrameSinkBroker> receiver);

  // Embeds the surface for `app_id` under `parent_frame_sink_id`. Registers
  // the hierarchy, tells the producer its LocalSurfaceId, and runs `callback`
  // with the FrameSinkId.
  //
  // As with RemoteFrame, the browser owns the FrameSinkId and the page owns
  // the LocalSurfaceId, whose embed_token the producer needs.
  //
  // `app_id` matches the one the producer passed to CreateFrameSink. If that
  // app has no sink yet, `callback` waits until it does: an <app> element can
  // exist before its client window.
  void Embed(const std::string& app_id,
             const viz::FrameSinkId& parent_frame_sink_id,
             const viz::LocalSurfaceId& local_surface_id,
             const gfx::Size& size,
             double scale,
             EmbedCallback callback);

  // Forwards the browser's displays to observers and stores them for
  // observers that connect later.
  //
  // Ignores an empty list, which means the screen has not been read yet
  // (DrmScreen never reports zero displays). Advertising no displays would
  // leave windows nowhere to go.
  void OnDisplaysChanged(std::vector<mojom::DisplayPtr> displays);

  // Forwards a copy in this browser to clipboard observers. Not stored: a
  // producer that connects later owns its own clipboard state.
  void OnCopied(mojom::Clipboard clipboard, const std::string& text);

  // mojom::FrameSinkBroker implementation.
  void CreateFrameSink(
      mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client,
      mojo::PendingReceiver<viz::mojom::CompositorFrameSink> receiver,
      mojo::PendingRemote<mojom::SurfaceObserver> observer,
      const std::string& app_id,
      CreateFrameSinkCallback callback) override;
  void DestroyFrameSink(const viz::FrameSinkId& frame_sink_id) override;
  void ImportBuffer(const viz::FrameSinkId& frame_sink_id,
                    gfx::GpuMemoryBufferHandle handle,
                    const gfx::Size& size,
                    uint32_t fourcc,
                    ImportBufferCallback callback) override;
  void SubmitBuffer(const viz::FrameSinkId& frame_sink_id,
                    uint64_t buffer_id,
                    const gfx::Rect& damage) override;
  void DestroyBuffer(const viz::FrameSinkId& frame_sink_id,
                     uint64_t buffer_id) override;
  void ConfigureDisplays(
      std::vector<mojom::DisplayLayoutPtr> layout) override;
  void SetClipboard(mojom::Clipboard clipboard,
                    const std::string& text) override;
  void ObserveClipboard(
      mojo::PendingRemote<mojom::ClipboardObserver> observer) override;
  void ObserveDisplays(
      mojo::PendingRemote<mojom::DisplayListObserver> observer) override;
  void CaptureDisplay(
      int64_t display_id,
      const gfx::Size& size,
      uint32_t max_fps,
      mojo::PendingReceiver<mojom::DisplayCapture> capture,
      mojo::PendingRemote<mojom::DisplayCaptureObserver> observer,
      CaptureDisplayCallback callback) override;

 private:
  // A page's embed request waiting for its producer.
  struct PendingEmbed {
    PendingEmbed(const std::string& app_id,
                 const viz::FrameSinkId& parent_frame_sink_id,
                 const viz::LocalSurfaceId& local_surface_id,
                 const gfx::Size& size,
                 double scale,
                 EmbedCallback callback);
    PendingEmbed(PendingEmbed&&);
    PendingEmbed& operator=(PendingEmbed&&);
    ~PendingEmbed();

    std::string app_id;
    viz::FrameSinkId parent_frame_sink_id;
    viz::LocalSurfaceId local_surface_id;
    gfx::Size size;
    double scale;
    EmbedCallback callback;
  };

  // The sink for `app_id`, or null if that app has no producer yet.
  //
  // A linear scan: there are few windows, and a second map would need updating
  // on disconnect.
  BrokeredFrameSink* SinkForApp(const std::string& app_id);

  // Destroys and unregisters every sink of the disconnected producer.
  void OnProducerDisconnected();

  // The sink `frame_sink_id` names, if this producer owns one.
  BrokeredFrameSink* OwnedFrameSink(const viz::FrameSinkId& frame_sink_id);

  const raw_ptr<viz::HostFrameSinkManager> host_frame_sink_manager_;
  const FrameSinkIdAllocator allocate_frame_sink_id_;
  const SharedImageInterfaceGetter get_shared_image_interface_;
  // See DisplayLayoutSetter.
  const DisplayLayoutSetter set_display_layout_;
  // See ClipboardSetter.
  const ClipboardSetter set_clipboard_;
  // See DisplayCaptureTargetGetter.
  const DisplayCaptureTargetGetter get_display_capture_target_;

  mojo::ReceiverSet<mojom::FrameSinkBroker> receivers_;

  base::flat_map<viz::FrameSinkId, std::unique_ptr<BrokeredFrameSink>>
      frame_sink_map_;

  std::vector<PendingEmbed> pending_embeds_;

  mojo::RemoteSet<mojom::DisplayListObserver> display_observers_;

  mojo::RemoteSet<mojom::ClipboardObserver> clipboard_observers_;

  // Running display captures, each until its producer closes it.
  base::flat_map<uint64_t, std::unique_ptr<DisplayCapture>> captures_;
  uint64_t next_capture_ = 1;

  // The last display list, or empty if none yet. See OnDisplaysChanged.
  std::vector<mojom::DisplayPtr> displays_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_FRAME_SINK_BROKER_H_
