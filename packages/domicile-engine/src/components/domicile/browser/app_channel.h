// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_APP_CHANNEL_H_
#define COMPONENTS_DOMICILE_BROWSER_APP_CHANNEL_H_

#include <memory>
#include <string>
#include <vector>

#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "components/domicile/browser/line_framer.h"
#include "components/domicile/mojom/app_channel.mojom.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "net/base/io_buffer.h"
#include "net/socket/unix_domain_client_socket_posix.h"

namespace domicile {

// An app module's channel, in the browser process: one connection to the
// compositor's socket that says `app_hello` and carries system calls. See
// docs/architecture/APP-MODULES.md.
//
// The compositor decides which calls an app may make. This only keeps the
// page's calls system calls, as ControlChannel::CallSystem does.
class AppChannel : public mojom::AppChannel {
 public:
  // `socket_path` is the compositor's --chrome-socket. Owns itself and deletes
  // itself when the page's end goes away, or closes it when the compositor
  // cannot be reached.
  AppChannel(const std::string& socket_path,
             mojo::PendingReceiver<mojom::AppChannel> receiver);

  AppChannel(const AppChannel&) = delete;
  AppChannel& operator=(const AppChannel&) = delete;

  ~AppChannel() override;

  // mojom::AppChannel:
  void SetClient(mojo::PendingRemote<mojom::AppChannelClient> client) override;
  void CallSystem(uint32_t id, const std::string& request) override;

 private:
  void Connect(const std::string& socket_path);
  void OnConnect(int result);
  void Send(std::string line);
  void WriteNext();
  void OnWrite(int result);
  void ReadLoop();
  void OnRead(int result);
  // One line off the socket: an answer goes to the page, and anything else,
  // such as `welcome`, stops here.
  void DispatchLine(const std::string& line);

  mojo::Receiver<mojom::AppChannel> receiver_;
  mojo::Remote<mojom::AppChannelClient> client_;

  std::unique_ptr<net::UnixDomainClientSocket> socket_;
  bool connected_ = false;

  // Lines waiting for the socket, in order. `app_hello` is first.
  std::vector<std::string> pending_;
  bool writing_ = false;
  scoped_refptr<net::DrainableIOBuffer> write_buffer_;

  // Answers that arrived before the page's SetClient, in order.
  std::vector<std::string> held_;

  scoped_refptr<net::IOBufferWithSize> read_buffer_;
  LineFramer framer_;

  base::WeakPtrFactory<AppChannel> weak_factory_{this};
};

// Binds an app channel, reading the compositor's socket path off the command
// line.
//
// THIS IS NOT THE ACCESS CONTROL. The caller binds it only for a document on
// an app's origin in a window pinned to that app. See
// PopulateChromeFrameBinders.
void BindAppChannel(mojo::PendingReceiver<mojom::AppChannel> receiver);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_APP_CHANNEL_H_
