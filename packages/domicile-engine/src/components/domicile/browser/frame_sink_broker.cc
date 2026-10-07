// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/frame_sink_broker.h"

#include <utility>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/functional/bind.h"
#include "components/domicile/browser/brokered_frame_sink.h"
#include "mojo/public/cpp/bindings/clone_traits.h"
#include "gpu/command_buffer/client/client_shared_image.h"
#include "gpu/command_buffer/client/shared_image_interface.h"
#include "components/viz/host/host_frame_sink_manager.h"

namespace domicile {

FrameSinkBroker::PendingEmbed::PendingEmbed(
    const std::string& app_id,
    const viz::FrameSinkId& parent_frame_sink_id,
    const viz::LocalSurfaceId& local_surface_id,
    const gfx::Size& size,
    double scale,
    EmbedCallback callback)
    : app_id(app_id),
      parent_frame_sink_id(parent_frame_sink_id),
      local_surface_id(local_surface_id),
      size(size),
      scale(scale),
      callback(std::move(callback)) {}

FrameSinkBroker::PendingEmbed::PendingEmbed(PendingEmbed&&) = default;

FrameSinkBroker::PendingEmbed& FrameSinkBroker::PendingEmbed::operator=(
    PendingEmbed&&) = default;

FrameSinkBroker::PendingEmbed::~PendingEmbed() = default;

FrameSinkBroker::FrameSinkBroker(
    viz::HostFrameSinkManager* host_frame_sink_manager,
    FrameSinkIdAllocator allocate_frame_sink_id,
    SharedImageInterfaceGetter get_shared_image_interface,
    DisplayLayoutSetter set_display_layout,
    ClipboardSetter set_clipboard,
    DisplayCaptureTargetGetter get_display_capture_target)
    : host_frame_sink_manager_(host_frame_sink_manager),
      allocate_frame_sink_id_(std::move(allocate_frame_sink_id)),
      get_shared_image_interface_(std::move(get_shared_image_interface)),
      set_display_layout_(std::move(set_display_layout)),
      set_clipboard_(std::move(set_clipboard)),
      get_display_capture_target_(std::move(get_display_capture_target)) {
  CHECK(host_frame_sink_manager);
  CHECK(allocate_frame_sink_id_);
  receivers_.set_disconnect_handler(base::BindRepeating(
      &FrameSinkBroker::OnProducerDisconnected, base::Unretained(this)));
}

FrameSinkBroker::~FrameSinkBroker() = default;

void FrameSinkBroker::Bind(
    mojo::PendingReceiver<mojom::FrameSinkBroker> receiver) {
  receivers_.Add(this, std::move(receiver));
}

void FrameSinkBroker::Embed(const std::string& app_id,
                            const viz::FrameSinkId& parent_frame_sink_id,
                            const viz::LocalSurfaceId& local_surface_id,
                            const gfx::Size& size,
                            double scale,
                            EmbedCallback callback) {
  BrokeredFrameSink* frame_sink = SinkForApp(app_id);
  if (!frame_sink) {
    // The <app> element can exist before its client connects, as on a shell
    // reload. Wait for this app's sink, not whichever is brokered next.
    pending_embeds_.emplace_back(app_id, parent_frame_sink_id, local_surface_id,
                                 size, scale, std::move(callback));
    return;
  }

  frame_sink->Embed(parent_frame_sink_id, local_surface_id, size, scale);
  std::move(callback).Run(frame_sink->frame_sink_id());
}

void FrameSinkBroker::CreateFrameSink(
    mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client,
    mojo::PendingReceiver<viz::mojom::CompositorFrameSink> receiver,
    mojo::PendingRemote<mojom::SurfaceObserver> observer,
    const std::string& app_id,
    CreateFrameSinkCallback callback) {
  const viz::FrameSinkId frame_sink_id = allocate_frame_sink_id_.Run();

  auto frame_sink = std::make_unique<BrokeredFrameSink>(
      host_frame_sink_manager_, frame_sink_id, std::move(observer),
      receivers_.current_receiver(), app_id,
      get_shared_image_interface_
          ? get_shared_image_interface_
          : base::BindRepeating([]() -> gpu::SharedImageInterface* {
              return nullptr;
            }));
  frame_sink->CreateCompositorFrameSink(std::move(client), std::move(receiver));
  BrokeredFrameSink* raw_frame_sink = frame_sink.get();
  frame_sink_map_[frame_sink_id] = std::move(frame_sink);

  std::move(callback).Run(frame_sink_id);

  // Answer embeds that were waiting for this app. Embeds for other apps keep
  // waiting.
  std::vector<PendingEmbed> still_waiting;
  for (PendingEmbed& embed : pending_embeds_) {
    if (embed.app_id != app_id) {
      still_waiting.push_back(std::move(embed));
      continue;
    }
    raw_frame_sink->Embed(embed.parent_frame_sink_id, embed.local_surface_id,
                          embed.size, embed.scale);
    std::move(embed.callback).Run(frame_sink_id);
  }
  pending_embeds_ = std::move(still_waiting);
}

void FrameSinkBroker::DestroyFrameSink(const viz::FrameSinkId& frame_sink_id) {
  auto iter = frame_sink_map_.find(frame_sink_id);
  if (iter == frame_sink_map_.end()) {
    receivers_.ReportBadMessage("No brokered frame sink for FrameSinkId");
    return;
  }
  if (iter->second->owner() != receivers_.current_receiver()) {
    receivers_.ReportBadMessage("FrameSinkId belongs to another producer");
    return;
  }
  frame_sink_map_.erase(iter);
}

// A producer may only use its own sinks, because a FrameSinkId is guessable.
BrokeredFrameSink* FrameSinkBroker::OwnedFrameSink(
    const viz::FrameSinkId& frame_sink_id) {
  auto iter = frame_sink_map_.find(frame_sink_id);
  if (iter == frame_sink_map_.end()) {
    receivers_.ReportBadMessage("No brokered frame sink for FrameSinkId");
    return nullptr;
  }
  if (iter->second->owner() != receivers_.current_receiver()) {
    receivers_.ReportBadMessage("FrameSinkId belongs to another producer");
    return nullptr;
  }
  return iter->second.get();
}

void FrameSinkBroker::ImportBuffer(const viz::FrameSinkId& frame_sink_id,
                                   gfx::GpuMemoryBufferHandle handle,
                                   const gfx::Size& size,
                                   uint32_t fourcc,
                                   ImportBufferCallback callback) {
  BrokeredFrameSink* frame_sink = OwnedFrameSink(frame_sink_id);
  if (!frame_sink) {
    std::move(callback).Run(0, std::nullopt);
    return;
  }
  std::optional<gpu::ExportedSharedImage> exported;
  const uint64_t buffer_id =
      frame_sink->ImportBuffer(std::move(handle), size, fourcc, &exported);
  std::move(callback).Run(buffer_id, std::move(exported));
}

void FrameSinkBroker::SubmitBuffer(const viz::FrameSinkId& frame_sink_id,
                                   uint64_t buffer_id,
                                   const gfx::Rect& damage) {
  BrokeredFrameSink* frame_sink = OwnedFrameSink(frame_sink_id);
  if (frame_sink) {
    frame_sink->SubmitBuffer(buffer_id, damage);
  }
}

void FrameSinkBroker::DestroyBuffer(const viz::FrameSinkId& frame_sink_id,
                                    uint64_t buffer_id) {
  BrokeredFrameSink* frame_sink = OwnedFrameSink(frame_sink_id);
  if (frame_sink) {
    frame_sink->DestroyBuffer(buffer_id);
  }
}

void FrameSinkBroker::ConfigureDisplays(
    std::vector<mojom::DisplayLayoutPtr> layout) {
  if (!set_display_layout_) {
    // No CRTC outside a tty. Not an error: the producer cannot know whether a
    // connector backs a display.
    return;
  }
  set_display_layout_.Run(std::move(layout));
}

void FrameSinkBroker::SetClipboard(mojom::Clipboard clipboard,
                                  const std::string& text) {
  if (!set_clipboard_) {
    // No desktop clipboard inside another session. Not an error: the producer
    // cannot know which clipboard the browser reads.
    return;
  }
  set_clipboard_.Run(clipboard, text);
}

void FrameSinkBroker::ObserveClipboard(
    mojo::PendingRemote<mojom::ClipboardObserver> observer) {
  clipboard_observers_.Add(std::move(observer));
}

void FrameSinkBroker::OnCopied(mojom::Clipboard clipboard,
                               const std::string& text) {
  for (auto& observer : clipboard_observers_) {
    observer->OnCopied(clipboard, text);
  }
}

void FrameSinkBroker::ObserveDisplays(
    mojo::PendingRemote<mojom::DisplayListObserver> observer) {
  const mojo::RemoteSetElementId id =
      display_observers_.Add(std::move(observer));
  if (!displays_.empty()) {
    display_observers_.Get(id)->OnDisplaysChanged(mojo::Clone(displays_));
  }
}

void FrameSinkBroker::OnDisplaysChanged(
    std::vector<mojom::DisplayPtr> displays) {
  if (displays.empty()) {
    return;
  }
  displays_ = std::move(displays);
  for (auto& observer : display_observers_) {
    observer->OnDisplaysChanged(mojo::Clone(displays_));
  }
}

void FrameSinkBroker::CaptureDisplay(
    int64_t display_id,
    const gfx::Size& size,
    uint32_t max_fps,
    mojo::PendingReceiver<mojom::DisplayCapture> capture,
    mojo::PendingRemote<mojom::DisplayCaptureObserver> observer,
    CaptureDisplayCallback callback) {
  if (size.IsEmpty() || max_fps == 0) {
    receivers_.ReportBadMessage("A display capture needs a size and a rate");
    std::move(callback).Run(false);
    return;
  }
  const std::optional<viz::FrameSinkId> target =
      get_display_capture_target_ ? get_display_capture_target_.Run(display_id)
                                  : std::nullopt;
  if (!target.has_value()) {
    // Not a bad message: a display's window opens after the display appears.
    std::move(callback).Run(false);
    return;
  }
  const bool gpu = get_shared_image_interface_ &&
                   get_shared_image_interface_.Run() != nullptr;
  const uint64_t id = next_capture_++;
  // Unretained: the broker owns every capture and the manager outlives it.
  captures_[id] = std::make_unique<DisplayCapture>(
      base::BindRepeating(
          [](viz::HostFrameSinkManager* manager,
             mojo::PendingReceiver<viz::mojom::FrameSinkVideoCapturer>
                 receiver) {
            manager->CreateVideoCapturer(std::move(receiver));
          },
          base::Unretained(host_frame_sink_manager_.get())),
      *target, size, max_fps, gpu, std::move(capture), std::move(observer),
      base::BindOnce(
          [](FrameSinkBroker* broker, uint64_t id) {
            broker->captures_.erase(id);
          },
          base::Unretained(this), id));
  std::move(callback).Run(true);
}

BrokeredFrameSink* FrameSinkBroker::SinkForApp(const std::string& app_id) {
  // An empty app id matches nothing, so a page never gets another app's
  // window.
  if (app_id.empty()) {
    return nullptr;
  }
  for (const auto& [id, sink] : frame_sink_map_) {
    if (sink->app_id() == app_id) {
      return sink.get();
    }
  }
  return nullptr;
}

void FrameSinkBroker::OnProducerDisconnected() {
  const mojo::ReceiverId owner = receivers_.current_receiver();
  base::EraseIf(frame_sink_map_, [owner](const auto& entry) {
    return entry.second->owner() == owner;
  });
}

}  // namespace domicile
