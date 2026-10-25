// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "content/browser/domicile/domicile_frame_sink_broker.h"

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/no_destructor.h"
#include "base/numerics/safe_conversions.h"
#include "base/process/process_handle.h"
#include "base/task/thread_pool.h"
#include "components/domicile/browser/browser_window_capture_target.h"
#include "components/domicile/browser/display_capture_target.h"
#include "components/domicile/browser/display_list.h"
#include "components/domicile/browser/external_surface_provider.h"
#include "components/domicile/browser/frame_sink_broker.h"
#include "components/domicile/browser/shell_origin.h"
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "content/browser/compositor/surface_utils.h"
#include "content/browser/domicile/domicile_desk.h"
#include "content/browser/domicile/domicile_spike_probe.h"
#include "content/browser/gpu/gpu_data_manager_impl.h"
#include "components/viz/common/gpu/raster_context_provider.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/gpu_utils.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_process_host.h"
#include "gpu/command_buffer/client/shared_image_interface.h"
#include "gpu/ipc/client/gpu_channel_host.h"
#include "ui/aura/env.h"
#include "ui/aura/window_tree_host.h"
#include "ui/compositor/compositor.h"
#include "ui/display/display.h"
#include "ui/display/display_observer.h"
#include "ui/base/clipboard/clipboard_buffer.h"
#include "ui/display/screen.h"
#include "ui/ozone/public/ozone_platform.h"
#include "mojo/public/cpp/bindings/message.h"
#include "mojo/public/cpp/platform/named_platform_channel.h"
#include "mojo/public/cpp/platform/platform_channel_server_endpoint.h"
#include "mojo/public/cpp/system/invitation.h"

namespace content {
namespace {

// Must match components/domicile/spike/solid_color_submitter.cc.
constexpr char kSocketSwitch[] = "domicile-broker-socket";

// Integers, not strings: ipcz indexes an invitation attachment by the first
// four bytes of its name, and maps any name not 4 or 8 bytes long to index 0
// (mojo/core/ipcz_driver/invitation.cc, GetAttachmentIndex), so two string
// names collide. At most Invitation::kMaxAttachments (7).
constexpr uint64_t kBrokerPipeName = 0;
constexpr uint64_t kProbePipeName = 1;

// The GPU interface that imports dmabufs, as components/exo/buffer.cc does.
// Lives in the browser because only it has aura::Env. Null without a GPU
// (--disable-gpu, --ozone-platform=headless).
gpu::SharedImageInterface* GetSharedImageInterface() {
  ui::ContextFactory* context_factory =
      aura::Env::GetInstance()->context_factory();
  if (!context_factory) {
    return nullptr;
  }
  scoped_refptr<viz::RasterContextProvider> context_provider =
      context_factory->SharedMainThreadRasterContextProvider();
  if (!context_provider) {
    return nullptr;
  }
  return context_provider->SharedImageInterface();
}

// The interface that makes a window in shared memory a software image, while
// the browser composites in software: 2D virtio-gpu, simpledrm, vkms,
// --disable-gpu. Null while it composites on the GPU, where viz draws no
// software image. Made on the GPU channel, as VizProcessTransportFactory makes
// a compositor's, and again after the channel is lost.
gpu::SharedImageInterface* GetSoftwareSharedImageInterface() {
  if (!content::GpuDataManagerImpl::GetInstance()->IsGpuCompositingDisabled()) {
    return nullptr;
  }
  static base::NoDestructor<scoped_refptr<gpu::GpuChannelHost>> channel;
  static base::NoDestructor<scoped_refptr<gpu::SharedImageInterface>> sii;
  if (!*channel || (*channel)->IsLost()) {
    *channel =
        content::GetGpuChannelEstablishFactory()->EstablishGpuChannelSync();
    if (!*channel) {
      LOG(ERROR) << "domicile: no GPU channel to make a window's software "
                    "image on";
      *sii = nullptr;
      return nullptr;
    }
    *sii = (*channel)->CreateClientSharedImageInterface();
  }
  return sii->get();
}

// The ozone platform whose displays are the machine's monitors. On any other
// platform Domicile runs nested, and its desktop is a window in another
// session.
constexpr char kScanoutPlatform[] = "drm";

// Must match ui/ozone/public/ozone_switches.cc. Copied to avoid a dependency
// for one string.
constexpr char kOzonePlatformSwitch[] = "ozone-platform";

// Forwards the screen's display list to the broker.
//
// On DRM, DrmScreen builds its DisplayList from the same snapshots that
// configure the CRTCs, so a hotplug already reaches this observer.
//
// Each notification re-reads the whole list: it is small, and the producer
// receives the whole list anyway.
class DomicileDisplayWatcher : public display::DisplayObserver {
 public:
  explicit DomicileDisplayWatcher(domicile::FrameSinkBroker* broker)
      : broker_(broker) {
    // BrowserMainRunnerImpl::Initialize builds the screen in
    // InitializeToolkit() before CreateStartupTasks(), which leads here. Crash
    // with a message if that order changes.
    CHECK(display::Screen::Get())
        << "domicile: no screen to read the displays off";
    display::Screen::Get()->AddObserver(this);
    Read();
  }

  DomicileDisplayWatcher(const DomicileDisplayWatcher&) = delete;
  DomicileDisplayWatcher& operator=(const DomicileDisplayWatcher&) = delete;

  ~DomicileDisplayWatcher() override {
    display::Screen::Get()->RemoveObserver(this);
  }

  // display::DisplayObserver implementation.
  void OnDisplayAdded(const display::Display& added) override { Read(); }
  void OnDisplaysRemoved(const display::Displays& removed) override { Read(); }
  void OnDisplayMetricsChanged(const display::Display& changed,
                               uint32_t changed_metrics) override {
    Read();
  }

 private:
  void Read() {
    broker_->OnDisplaysChanged(domicile::DisplayListFor(
        display::Screen::Get()->GetAllDisplays(),
        ui::OzonePlatform::GetInstance()->GetDomicileConnectors()));
  }

  const raw_ptr<domicile::FrameSinkBroker> broker_;
};

// Maps the mojom clipboard to ui's. A switch rather than a cast, because the
// owners of either enum may reorder it, and a copy on the wrong clipboard
// would paste unexpected text.
ui::ClipboardBuffer BufferOf(domicile::mojom::Clipboard clipboard) {
  switch (clipboard) {
    case domicile::mojom::Clipboard::kCopy:
      return ui::ClipboardBuffer::kCopyPaste;
    case domicile::mojom::Clipboard::kPrimary:
      return ui::ClipboardBuffer::kSelection;
  }
}

// The reverse. Returns `std::nullopt` for buffers with no desktop clipboard,
// such as `kDrag`, since a drag is not a copy.
std::optional<domicile::mojom::Clipboard> ClipboardOf(
    ui::ClipboardBuffer buffer) {
  switch (buffer) {
    case ui::ClipboardBuffer::kCopyPaste:
      return domicile::mojom::Clipboard::kCopy;
    case ui::ClipboardBuffer::kSelection:
      return domicile::mojom::Clipboard::kPrimary;
    default:
      return std::nullopt;
  }
}

// A switch rather than a cast, so a new transform is a compile error here.
ui::DomicileDisplayLayout::Transform TransformOf(
    domicile::mojom::DisplayTransform transform) {
  switch (transform) {
    case domicile::mojom::DisplayTransform::kNormal:
      return ui::DomicileDisplayLayout::Transform::kNormal;
    case domicile::mojom::DisplayTransform::kRotate90:
      return ui::DomicileDisplayLayout::Transform::kRotate90;
    case domicile::mojom::DisplayTransform::kRotate180:
      return ui::DomicileDisplayLayout::Transform::kRotate180;
    case domicile::mojom::DisplayTransform::kRotate270:
      return ui::DomicileDisplayLayout::Transform::kRotate270;
  }
}

// Applies the producer's display layout. Every ozone platform but DRM ignores
// it, and //components/domicile/browser cannot depend on //ui/ozone, so this
// lives here.
void SetDisplayLayout(std::vector<domicile::mojom::DisplayLayoutPtr> layout) {
  std::vector<ui::DomicileDisplayLayout> wanted;
  wanted.reserve(layout.size());
  for (const domicile::mojom::DisplayLayoutPtr& display : layout) {
    wanted.push_back({.id = display->id,
                      .enabled = display->enabled,
                      .origin = display->origin,
                      .transform = TransformOf(display->transform),
                      .scale = display->scale,
                      .desk = display->desk});
  }
  ui::OzonePlatform::GetInstance()->SetDomicileDisplayLayout(wanted);
  // Update the desk after requesting the modeset, so a page moved onto a
  // display finds it lit.
  if (wanted.empty()) {
    // The hardware places every display. A blank is a list of disabled
    // displays, never an empty one.
    DomicileDeskLaidOut(std::nullopt);
    return;
  }
  std::vector<DomicileDeskDisplay> lit;
  for (const ui::DomicileDisplayLayout& display : wanted) {
    if (display.enabled) {
      lit.push_back({.id = display.id,
                     .desk = display.desk,
                     .scale = static_cast<float>(display.scale)});
    }
  }
  DomicileDeskLaidOut(std::move(lit));
}

// Binds the producer's tablets and touchscreens to displays. Lives here for
// SetDisplayLayout's reason; every platform but DRM ignores it.
void SetPointerTargets(std::vector<domicile::mojom::PointerTargetPtr> targets) {
  std::vector<ui::DomicilePointerTarget> wanted;
  wanted.reserve(targets.size());
  for (const domicile::mojom::PointerTargetPtr& target : targets) {
    wanted.push_back(
        {.device = target->device, .display_id = target->display_id});
  }
  ui::OzonePlatform::GetInstance()->SetDomicilePointerTargets(
      std::move(wanted));
}

// Sets every display's white point. Lives here for SetDisplayLayout's reason;
// every platform but DRM ignores it.
void SetWhitePoint(float red, float green, float blue) {
  ui::OzonePlatform::GetInstance()->SetDomicileWhitePoint(
      {.red = red, .green = green, .blue = blue});
}

// Sets the clipboard this process pastes from.
//
// Lives here because //components/domicile/browser cannot depend on //ui/ozone.
// Every platform but DRM ignores it: a nested run uses the host session's
// clipboard.
void SetClipboard(
    domicile::mojom::Clipboard clipboard,
    const domicile::FrameSinkBroker::ClipboardContents& contents) {
  ui::OzonePlatform::GetInstance()->SetDomicileClipboard(BufferOf(clipboard),
                                                         contents);
}

// The root frame sink of the browser window showing `display_id`, for a
// display capture. See domicile::CaptureTargetFor for the matching.
std::optional<viz::FrameSinkId> DisplayCaptureTarget(int64_t display_id) {
  std::vector<domicile::CaptureRoot> windows;
  for (aura::WindowTreeHost* host :
       aura::Env::GetInstance()->window_tree_hosts()) {
    windows.push_back({.bounds_in_pixels = host->GetBoundsInPixels(),
                       .frame_sink_id = host->compositor()->frame_sink_id()});
  }
  return domicile::CaptureTargetFor(
      display_id, display::Screen::Get()->GetAllDisplays(), windows);
}

// The browser's frame sink broker and the socket producers reach it over.
//
// The socket path is the only access control. A FrameSinkBroker pipe can
// allocate any frame sink in viz. Renderers cannot get the invitation, and the
// ExternalSurfaceProvider they do get cannot allocate.
class DomicileBrowserService {
 public:
  DomicileBrowserService()
      : broker_(GetHostFrameSinkManager(),
                base::BindRepeating(&AllocateFrameSinkId),
                base::BindRepeating(&GetSharedImageInterface),
                base::BindRepeating(&SetDisplayLayout),
                base::BindRepeating(&SetClipboard),
                base::BindRepeating(&DisplayCaptureTarget),
                base::BindRepeating(&domicile::FindBrowserWindowCaptureTarget),
                base::BindRepeating(&SetPointerTargets),
                base::BindRepeating(&GetSoftwareSharedImageInterface),
                base::BindRepeating(&SetWhitePoint)),
        provider_(&broker_) {
    // Registered on every platform so copies made in a page reach the producer.
    // `SetClipboard` handles copies made outside. Unretained is safe: this is a
    // NoDestructor on the UI thread.
    ui::OzonePlatform::GetInstance()->SetDomicileCopiedCallback(
        base::BindRepeating(&DomicileBrowserService::Copied,
                            base::Unretained(this)));
    const base::CommandLine& command_line =
        *base::CommandLine::ForCurrentProcess();
    // Only on DRM. A nested run's screen is the host's monitors, which are not
    // the producer's desktop.
    if (command_line.GetSwitchValueASCII(kOzonePlatformSwitch) ==
        kScanoutPlatform) {
      displays_ = std::make_unique<DomicileDisplayWatcher>(&broker_);
    }
    if (!command_line.HasSwitch(kSocketSwitch)) {
      return;
    }
    const std::string socket_path =
        command_line.GetSwitchValueASCII(kSocketSwitch);
    // An invitation is accepted once, so a compositor restarted under this
    // browser needs a new one. Binding again replaces the dead compositor's
    // socket file. See "A compositor restart" in
    // docs/architecture/ENGINE-FORK.md. Unretained for Copied's reason.
    broker_.SetProducerGoneCallback(base::BindRepeating(
        &DomicileBrowserService::Listen, base::Unretained(this), socket_path));
    Listen(socket_path);
  }

  DomicileBrowserService(const DomicileBrowserService&) = delete;
  DomicileBrowserService& operator=(const DomicileBrowserService&) = delete;

  ~DomicileBrowserService() = default;

  void Bind(
      mojo::PendingReceiver<domicile::mojom::ExternalSurfaceProvider> receiver,
      uint32_t renderer_client_id) {
    provider_.Bind(std::move(receiver), renderer_client_id);
  }

 private:
  // Forwards a copy made in this browser to the producer.
  void Copied(ui::ClipboardBuffer buffer,
              const ui::OzonePlatform::DomicileClipboardContents& contents) {
    std::optional<domicile::mojom::Clipboard> clipboard = ClipboardOf(buffer);
    if (clipboard.has_value()) {
      broker_.OnCopied(*clipboard, contents);
    }
  }

  // Binding the socket does blocking I/O, so it runs off the UI thread.
  //
  // Nothing waits for the result. A producer connects once the socket exists,
  // and a page that embeds first waits in the broker.
  void Listen(const std::string& socket_path) {
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, {base::MayBlock()},
        base::BindOnce(&DomicileBrowserService::BindSocket, socket_path),
        base::BindOnce(&DomicileBrowserService::SendInvitation,
                       base::Unretained(this), socket_path));
  }

  static mojo::PlatformChannelServerEndpoint BindSocket(
      const std::string& socket_path) {
    mojo::NamedPlatformChannel::Options options;
    options.server_name =
        mojo::NamedPlatformChannel::ServerNameFromUTF8(socket_path);
    return mojo::NamedPlatformChannel(options).TakeServerEndpoint();
  }

  void SendInvitation(const std::string& socket_path,
                      mojo::PlatformChannelServerEndpoint endpoint) {
    // Crash rather than log: the switch asked for a socket, and a browser
    // without one looks like a page that never embedded, which misleads
    // debugging.
    CHECK(endpoint.is_valid())
        << "domicile: could not listen on " << socket_path;

    mojo::OutgoingInvitation invitation;
    broker_.Bind(mojo::PendingReceiver<domicile::mojom::FrameSinkBroker>(
        invitation.AttachMessagePipe(kBrokerPipeName)));
    BindDomicileSpikeProbe(
        mojo::PendingReceiver<domicile::mojom::SpikeProbe>(
            invitation.AttachMessagePipe(kProbePipeName)));

    // An invitation, not mojo::IsolatedConnection, because the broker forwards
    // the producer's CompositorFrameSink receiver to the viz process and an
    // isolated connection cannot carry that handle. See
    // docs/architecture/ENGINE-FORK.md#how-the-producer-reaches-the-broker.
    //
    // The producer is not a child process, so there is no process handle. POSIX
    // does not need one.
    mojo::OutgoingInvitation::Send(std::move(invitation),
                                   base::kNullProcessHandle,
                                   std::move(endpoint));
    LOG(INFO) << "domicile: frame sink broker listening on " << socket_path;
  }

  domicile::FrameSinkBroker broker_;
  domicile::ExternalSurfaceProvider provider_;
  // Null off DRM.
  std::unique_ptr<DomicileDisplayWatcher> displays_;
};

DomicileBrowserService& GetDomicileBrowserService() {
  CHECK_CURRENTLY_ON(BrowserThread::UI);
  static base::NoDestructor<DomicileBrowserService> service;
  return *service;
}

}  // namespace

void StartDomicileFrameSinkBroker() {
  // Constructing the service opens the socket if the switch is set.
  GetDomicileBrowserService();
}

void BindDomicileExternalSurfaceProvider(
    RenderFrameHost* frame,
    mojo::PendingReceiver<domicile::mojom::ExternalSurfaceProvider> receiver) {
  // Checked at bind time: the binder map is built before a document commits.
  if (!domicile::IsShellOrigin(frame->GetLastCommittedOrigin())) {
    mojo::ReportBadMessage("domicile: only the shell may embed a window.");
  } else {
    // A frame sink's client id is its renderer's process id; see
    // RenderProcessHostImpl::CreateEmbeddedFrameSinkProvider.
    GetDomicileBrowserService().Bind(
        std::move(receiver),
        base::checked_cast<uint32_t>(frame->GetProcess()->GetDeprecatedID()));
  }
}

}  // namespace content
