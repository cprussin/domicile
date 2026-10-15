// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/frame_sink_broker.h"

#include <utility>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/containers/flat_set.h"
#include "base/functional/bind.h"
#include "components/domicile/browser/brokered_frame_sink.h"
#include "mojo/public/cpp/bindings/clone_traits.h"
#include "gpu/command_buffer/client/client_shared_image.h"
#include "gpu/command_buffer/client/shared_image_interface.h"
#include "components/viz/host/host_frame_sink_manager.h"

namespace domicile {

FrameSinkBroker::PendingEmbed::PendingEmbed(
    uint64_t requester,
    const std::string& app_id,
    const viz::FrameSinkId& parent_frame_sink_id,
    const viz::LocalSurfaceId& local_surface_id,
    const gfx::Size& size,
    double scale,
    EmbedCallback callback)
    : requester(requester),
      app_id(app_id),
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
    DisplayCaptureTargetGetter get_display_capture_target,
    BrowserWindowCaptureTargetGetter get_browser_window_capture_target,
    PointerTargetsSetter set_pointer_targets)
    : host_frame_sink_manager_(host_frame_sink_manager),
      allocate_frame_sink_id_(std::move(allocate_frame_sink_id)),
      get_shared_image_interface_(std::move(get_shared_image_interface)),
      set_display_layout_(std::move(set_display_layout)),
      set_clipboard_(std::move(set_clipboard)),
      get_display_capture_target_(std::move(get_display_capture_target)),
      get_browser_window_capture_target_(
          std::move(get_browser_window_capture_target)),
      set_pointer_targets_(std::move(set_pointer_targets)) {
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

void FrameSinkBroker::SetProducerGoneCallback(base::RepeatingClosure callback) {
  producer_gone_ = std::move(callback);
}

uint64_t FrameSinkBroker::NewEmbedRequester() {
  return next_embed_requester_++;
}

void FrameSinkBroker::Embed(uint64_t requester,
                            const std::string& app_id,
                            const viz::FrameSinkId& parent_frame_sink_id,
                            const viz::LocalSurfaceId& local_surface_id,
                            const gfx::Size& size,
                            double scale,
                            EmbedCallback callback) {
  // Sent before the page heard its compositor went away.
  if (disconnected_embed_tokens_.contains(local_surface_id.embed_token())) {
    std::move(callback).Run(std::nullopt);
    return;
  }
  BrokeredFrameSink* frame_sink = SinkForApp(app_id);
  if (!frame_sink) {
    // The <app> element can exist before its client connects, as on a shell
    // reload. Wait for this app's sink, not whichever is brokered next.
    pending_embeds_.emplace_back(requester, app_id, parent_frame_sink_id,
                                 local_surface_id, size, scale,
                                 std::move(callback));
    return;
  }

  frame_sink->Embed(parent_frame_sink_id, local_surface_id, size, scale);
  embed_tokens_[frame_sink->frame_sink_id()].insert(
      local_surface_id.embed_token());
  std::move(callback).Run(frame_sink->frame_sink_id());
}

void FrameSinkBroker::DropEmbeds(uint64_t requester) {
  std::erase_if(pending_embeds_, [requester](const PendingEmbed& embed) {
    return embed.requester == requester;
  });
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
    embed_tokens_[frame_sink_id].insert(embed.local_surface_id.embed_token());
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
  EraseFrameSink(iter, mojom::FrameSinkEnd::kClosed);
}

void FrameSinkBroker::WaitForEnd(const viz::FrameSinkId& frame_sink_id,
                                 EndCallback callback) {
  if (!frame_sink_map_.contains(frame_sink_id)) {
    std::move(callback).Run(disconnected_frame_sinks_.contains(frame_sink_id)
                                ? mojom::FrameSinkEnd::kProducerGone
                                : mojom::FrameSinkEnd::kClosed);
    return;
  }
  end_waiters_[frame_sink_id].push_back(std::move(callback));
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

void FrameSinkBroker::FenceBuffer(const viz::FrameSinkId& frame_sink_id,
                                  uint64_t buffer_id,
                                  gfx::GpuFenceHandle fence,
                                  FenceBufferCallback callback) {
  BrokeredFrameSink* frame_sink = OwnedFrameSink(frame_sink_id);
  std::move(callback).Run(
      frame_sink ? frame_sink->FenceBuffer(buffer_id, std::move(fence))
                 : std::nullopt);
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

void FrameSinkBroker::ConfigurePointers(
    std::vector<mojom::PointerTargetPtr> targets) {
  if (!set_pointer_targets_) {
    // No CRTC outside a tty, as for ConfigureDisplays.
    return;
  }
  set_pointer_targets_.Run(std::move(targets));
}

void FrameSinkBroker::SetClipboard(mojom::Clipboard clipboard,
                                  const ClipboardContents& contents) {
  if (!set_clipboard_) {
    // No desktop clipboard inside another session. Not an error: the producer
    // cannot know which clipboard the browser reads.
    return;
  }
  set_clipboard_.Run(clipboard, contents);
}

void FrameSinkBroker::ObserveClipboard(
    mojo::PendingRemote<mojom::ClipboardObserver> observer) {
  clipboard_observers_.Add(std::move(observer));
}

void FrameSinkBroker::OnCopied(mojom::Clipboard clipboard,
                               const ClipboardContents& contents) {
  for (auto& observer : clipboard_observers_) {
    observer->OnCopied(clipboard, contents);
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
  StartCapture(*target, size, max_fps, std::move(capture), std::move(observer));
  std::move(callback).Run(true);
}

void FrameSinkBroker::CaptureBrowserWindow(
    const std::string& window_id,
    uint32_t max_fps,
    mojo::PendingReceiver<mojom::DisplayCapture> capture,
    mojo::PendingRemote<mojom::DisplayCaptureObserver> observer,
    CaptureBrowserWindowCallback callback) {
  if (max_fps == 0) {
    receivers_.ReportBadMessage("A browser window capture needs a rate");
    std::move(callback).Run(false);
    return;
  }
  const std::optional<BrowserWindowCaptureTarget> target =
      get_browser_window_capture_target_
          ? get_browser_window_capture_target_.Run(window_id)
          : std::nullopt;
  if (!target.has_value()) {
    // Not a bad message: the window may have closed since the producer heard
    // of it.
    std::move(callback).Run(false);
    return;
  }
  StartCapture(target->frame_sink_id, target->size_in_pixels, max_fps,
               std::move(capture), std::move(observer));
  std::move(callback).Run(true);
}

void FrameSinkBroker::StartCapture(
    const viz::FrameSinkId& target,
    const gfx::Size& size,
    uint32_t max_fps,
    mojo::PendingReceiver<mojom::DisplayCapture> capture,
    mojo::PendingRemote<mojom::DisplayCaptureObserver> observer) {
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
      target, size, max_fps, gpu, std::move(capture), std::move(observer),
      base::BindOnce(
          [](FrameSinkBroker* broker, uint64_t id) {
            broker->captures_.erase(id);
          },
          base::Unretained(this), id));
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
  std::vector<viz::FrameSinkId> owned;
  for (const auto& [id, sink] : frame_sink_map_) {
    if (sink->owner() == owner) {
      owned.push_back(id);
    }
  }
  for (const viz::FrameSinkId& id : owned) {
    EraseFrameSink(frame_sink_map_.find(id),
                   mojom::FrameSinkEnd::kProducerGone);
  }
  if (producer_gone_) {
    producer_gone_.Run();
  }
}

void FrameSinkBroker::EraseFrameSink(
    base::flat_map<viz::FrameSinkId,
                   std::unique_ptr<BrokeredFrameSink>>::iterator iter,
    mojom::FrameSinkEnd end) {
  // Copied: `iter` is invalid after the erase.
  const viz::FrameSinkId frame_sink_id = iter->first;
  frame_sink_map_.erase(iter);

  auto tokens = embed_tokens_.find(frame_sink_id);
  if (end == mojom::FrameSinkEnd::kProducerGone) {
    disconnected_frame_sinks_.insert(frame_sink_id);
    if (tokens != embed_tokens_.end()) {
      disconnected_embed_tokens_.insert(tokens->second.begin(),
                                        tokens->second.end());
    }
  }
  if (tokens != embed_tokens_.end()) {
    embed_tokens_.erase(tokens);
  }

  auto waiters = end_waiters_.find(frame_sink_id);
  if (waiters == end_waiters_.end()) {
    return;
  }
  std::vector<EndCallback> callbacks = std::move(waiters->second);
  end_waiters_.erase(waiters);
  for (EndCallback& callback : callbacks) {
    std::move(callback).Run(end);
  }
}

}  // namespace domicile
