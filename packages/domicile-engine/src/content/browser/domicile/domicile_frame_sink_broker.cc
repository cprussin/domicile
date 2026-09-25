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
#include "base/process/process_handle.h"
#include "base/task/thread_pool.h"
#include "components/domicile/browser/display_list.h"
#include "components/domicile/browser/external_surface_provider.h"
#include "components/domicile/browser/frame_sink_broker.h"
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "content/browser/compositor/surface_utils.h"
#include "content/browser/domicile/domicile_spike_probe.h"
#include "components/viz/common/gpu/raster_context_provider.h"
#include "content/public/browser/browser_thread.h"
#include "gpu/command_buffer/client/shared_image_interface.h"
#include "ui/aura/env.h"
#include "ui/compositor/compositor.h"
#include "ui/display/display.h"
#include "ui/display/display_observer.h"
#include "ui/base/clipboard/clipboard_buffer.h"
#include "ui/display/screen.h"
#include "ui/ozone/public/ozone_platform.h"
#include "mojo/public/cpp/platform/named_platform_channel.h"
#include "mojo/public/cpp/platform/platform_channel_server_endpoint.h"
#include "mojo/public/cpp/system/invitation.h"

namespace content {
namespace {

// Must match components/domicile/spike/solid_color_submitter.cc.
constexpr char kSocketSwitch[] = "domicile-broker-socket";

// Integer, not string, and that is not a style choice. Under ipcz an invitation
// attachment is indexed by the first four bytes of its name read as a
// little-endian integer, and any name that is not exactly 4 or 8 bytes long
// lands on index 0 (mojo/core/ipcz_driver/invitation.cc, GetAttachmentIndex).
// So two string-named pipes on one invitation collide, and the second attach
// fails with MOJO_RESULT_ALREADY_EXISTS. Small integers, and at most
// Invitation::kMaxAttachments (7) of them.
constexpr uint64_t kBrokerPipeName = 0;
constexpr uint64_t kProbePipeName = 1;

// How an imported dmabuf reaches a GPU, and the reason the exo::Buffer port
// lives in the browser: components/exo/buffer.cc:95 does exactly this, and
// aura::Env exists in no other process. Null when there is no GPU — every
// --disable-gpu run, and every --ozone-platform=headless one, where a dmabuf
// could not be imported anyway.
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

// The ozone platform on which the browser's displays ARE the machine's, rather
// than some other compositor's. Only there does a producer want them: a
// Domicile running nested is a window inside somebody else's session, and its
// desktop is that window rather than the host's monitors.
constexpr char kScanoutPlatform[] = "drm";

// Must match ui/ozone/public/ozone_switches.cc. Spelled out rather than
// included for the same reason kSocketSwitch above is: content/browser reads a
// command line it does not own, and //ui/ozone is not a dependency this file is
// worth adding to that target for one string.
constexpr char kOzonePlatformSwitch[] = "ozone-platform";

// Keeps the broker's display list level with the screen's.
//
// A display::DisplayObserver rather than anything of Domicile's own: on the
// DRM platform DrmScreen drives its DisplayList from the same snapshots the
// modeset driver configures the CRTCs from, and DisplayList notifies from
// AddOrUpdateDisplay and RemoveDisplay -- so a hotplug is already an
// observation and needs no second route.
//
// Every notification re-reads the whole list rather than applying the delta it
// was handed. The list is small, the producer is told the whole list anyway,
// and a delta applied to a copy is a second copy to keep honest.
class DomicileDisplayWatcher : public display::DisplayObserver {
 public:
  explicit DomicileDisplayWatcher(domicile::FrameSinkBroker* broker)
      : broker_(broker) {
    // The one ordering this depends on, stated rather than assumed.
    // BrowserMainRunnerImpl::Initialize runs InitializeToolkit() -- which is
    // where the parts build the screen -- before CreateStartupTasks(), and
    // PostCreateThreadsImpl() is where this is reached from. A null screen
    // means that stopped being true, and is worth a named crash rather than
    // the one a null deref gives.
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
    broker_->OnDisplaysChanged(
        domicile::DisplayListFor(display::Screen::Get()->GetAllDisplays()));
  }

  const raw_ptr<domicile::FrameSinkBroker> broker_;
};

// The producer's answer about the connectors, on its way to the platform that
// owns them.
//
// Here rather than in //components/domicile/browser for the reason the two
// getters above are there: the only route to a CRTC is //ui/ozone, and that
// target deliberately depends on neither that nor //content. Every ozone
// platform but DRM implements this as nothing, because every other one is a
// window inside somebody else's session.
// Which clipboard, in the two vocabularies this file has to hold at once.
//
// A function each way rather than a cast, for the reason every other
// translation here is written out: the two enumerations are somebody else's to
// reorder, and a copy that arrived on the wrong one of two clipboards would be
// a paste that quietly produces what a person only brushed past.
ui::ClipboardBuffer BufferOf(domicile::mojom::Clipboard clipboard) {
  switch (clipboard) {
    case domicile::mojom::Clipboard::kCopy:
      return ui::ClipboardBuffer::kCopyPaste;
    case domicile::mojom::Clipboard::kPrimary:
      return ui::ClipboardBuffer::kSelection;
  }
}

// The other way. `std::nullopt` is a buffer this desktop has no clipboard for
// -- `kDrag` is one, on the platforms that have it -- which is dropped rather
// than folded onto one of the two: a drag is not a copy, and a producer told
// it was would put it on the seat.
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

// The producer's turn, in ozone's words. The same four names in the same
// order, and a switch rather than a cast so that a fifth is a compile error
// here rather than a monitor turned the wrong way.
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

void SetDisplayLayout(std::vector<domicile::mojom::DisplayLayoutPtr> layout) {
  std::vector<ui::DomicileDisplayLayout> wanted;
  wanted.reserve(layout.size());
  for (const domicile::mojom::DisplayLayoutPtr& display : layout) {
    wanted.push_back({.id = display->id,
                      .enabled = display->enabled,
                      .origin = display->origin,
                      .transform = TransformOf(display->transform),
                      .scale = display->scale});
  }
  ui::OzonePlatform::GetInstance()->SetDomicileDisplayLayout(wanted);
}

// The producer's word about a clipboard, on its way to the one this process
// pastes out of.
//
// Here rather than in //components/domicile/browser for the reason the getters
// above are there: the clipboard the browser reads is ui::OzonePlatform's, and
// that target deliberately depends on neither //ui/ozone nor //content. Every
// ozone platform but DRM implements this as nothing, because every other one
// is a window inside somebody else's session and reads that session's
// clipboard.
void SetClipboard(domicile::mojom::Clipboard clipboard,
                  const std::string& text) {
  ui::OzonePlatform::GetInstance()->SetDomicileClipboard(BufferOf(clipboard),
                                                         text);
}

// The browser's frame sink broker and the socket a producer reaches it over.
//
// The socket path is the access control, and it is the whole of it. Holding a
// FrameSinkBroker pipe is unrestricted authority to allocate frame sinks in
// viz, so whoever can open the path can do that and nobody else can: the
// invitation is not something a renderer can be handed, and what a renderer
// does get — ExternalSurfaceProvider — cannot allocate anything.
class DomicileBrowserService {
 public:
  DomicileBrowserService()
      : broker_(GetHostFrameSinkManager(),
                base::BindRepeating(&AllocateFrameSinkId),
                base::BindRepeating(&GetSharedImageInterface),
                base::BindRepeating(&SetDisplayLayout),
                base::BindRepeating(&SetClipboard)),
        provider_(&broker_) {
    // Registered whatever platform this is, because a copy made in a page has
    // to reach the producer on all of them: what differs is where a copy made
    // ELSEWHERE lands, and that is `SetClipboard`'s half. Unretained is the
    // lifetime this object already has -- a NoDestructor on the UI thread.
    ui::OzonePlatform::GetInstance()->SetDomicileCopiedCallback(
        base::BindRepeating(&DomicileBrowserService::Copied,
                            base::Unretained(this)));
    const base::CommandLine& command_line =
        *base::CommandLine::ForCurrentProcess();
    // Watched on the platform that scans out and nowhere else. A nested run's
    // screen is the HOST's monitors, and a producer told about those would
    // take its desktop away from the window that defines it.
    if (command_line.GetSwitchValueASCII(kOzonePlatformSwitch) ==
        kScanoutPlatform) {
      displays_ = std::make_unique<DomicileDisplayWatcher>(&broker_);
    }
    if (!command_line.HasSwitch(kSocketSwitch)) {
      return;
    }
    Listen(command_line.GetSwitchValueASCII(kSocketSwitch));
  }

  DomicileBrowserService(const DomicileBrowserService&) = delete;
  DomicileBrowserService& operator=(const DomicileBrowserService&) = delete;

  ~DomicileBrowserService() = default;

  void Bind(
      mojo::PendingReceiver<domicile::mojom::ExternalSurfaceProvider> receiver) {
    provider_.Bind(std::move(receiver));
  }

 private:
  // Something was copied in this browser, on its way to the producer that is
  // the desktop's clipboard.
  void Copied(ui::ClipboardBuffer buffer, const std::string& text) {
    std::optional<domicile::mojom::Clipboard> clipboard = ClipboardOf(buffer);
    if (clipboard.has_value()) {
      broker_.OnCopied(*clipboard, text);
    }
  }

  // Binding the socket is a mkdir and a bind, and this is the UI thread. So it
  // is posted, wherever it is called from.
  //
  // Nothing waits for the result. A producer connects whenever the socket turns
  // up, and a page that embedded first is already waiting in the broker.
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
    // Loudly, rather than logging and carrying on. --domicile-broker-socket is
    // explicit: somebody asked for a socket at this path, and a browser that
    // quietly does not have one looks from the outside exactly like a page that
    // never asked to embed, which is the wrong thing to go and debug.
    CHECK(endpoint.is_valid())
        << "domicile: could not listen on " << socket_path;

    mojo::OutgoingInvitation invitation;
    broker_.Bind(mojo::PendingReceiver<domicile::mojom::FrameSinkBroker>(
        invitation.AttachMessagePipe(kBrokerPipeName)));
    BindDomicileSpikeProbe(
        mojo::PendingReceiver<domicile::mojom::SpikeProbe>(
            invitation.AttachMessagePipe(kProbePipeName)));

    // A real invitation, not mojo::IsolatedConnection: the broker's whole job
    // is forwarding the producer's CompositorFrameSink receiver on to the viz
    // process, and an isolated connection cannot carry a handle that far. See
    // ENGINE-FORK.md, "How the producer reaches the broker".
    //
    // The producer is not a child process, so there is no process handle to
    // give. On POSIX that costs nothing.
    mojo::OutgoingInvitation::Send(std::move(invitation),
                                   base::kNullProcessHandle,
                                   std::move(endpoint));
    LOG(WARNING) << "domicile: frame sink broker listening on " << socket_path;
  }

  domicile::FrameSinkBroker broker_;
  domicile::ExternalSurfaceProvider provider_;
  // Null off the scanout platform, which is every nested run.
  std::unique_ptr<DomicileDisplayWatcher> displays_;
};

DomicileBrowserService& GetDomicileBrowserService() {
  CHECK_CURRENTLY_ON(BrowserThread::UI);
  static base::NoDestructor<DomicileBrowserService> service;
  return *service;
}

}  // namespace

void StartDomicileFrameSinkBroker() {
  // Constructing it is what opens the socket, and the constructor is the one
  // that checks for the switch — so a browser that was not given a path does
  // nothing here beyond building an object that binds nothing.
  GetDomicileBrowserService();
}

void BindDomicileExternalSurfaceProvider(
    mojo::PendingReceiver<domicile::mojom::ExternalSurfaceProvider> receiver) {
  GetDomicileBrowserService().Bind(std::move(receiver));
}

}  // namespace content
