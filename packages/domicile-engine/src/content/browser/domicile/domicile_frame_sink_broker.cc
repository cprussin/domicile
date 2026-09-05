// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "content/browser/domicile/domicile_frame_sink_broker.h"

#include <cstdint>
#include <string>
#include <utility>

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/process/process_handle.h"
#include "base/task/thread_pool.h"
#include "components/domicile/browser/external_surface_provider.h"
#include "components/domicile/browser/frame_sink_broker.h"
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "content/browser/compositor/surface_utils.h"
#include "content/browser/domicile/domicile_spike_probe.h"
#include "content/public/browser/browser_thread.h"
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
                base::BindRepeating(&AllocateFrameSinkId)),
        provider_(&broker_) {
    const base::CommandLine& command_line =
        *base::CommandLine::ForCurrentProcess();
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
  // Binding the socket is a mkdir and a bind, so it cannot happen here: this
  // runs on the UI thread, where a page's first embed request arrives, and the
  // UI thread disallows blocking. Step 2 never met that — it ran in
  // PostCreateThreads, where blocking is allowed.
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
};

DomicileBrowserService& GetDomicileBrowserService() {
  CHECK_CURRENTLY_ON(BrowserThread::UI);
  static base::NoDestructor<DomicileBrowserService> service;
  return *service;
}

}  // namespace

void BindDomicileExternalSurfaceProvider(
    mojo::PendingReceiver<domicile::mojom::ExternalSurfaceProvider> receiver) {
  GetDomicileBrowserService().Bind(std::move(receiver));
}

}  // namespace content
