// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_CONTROL_CHANNEL_H_
#define COMPONENTS_DOMICILE_BROWSER_CONTROL_CHANNEL_H_

#include <memory>
#include <string>
#include <vector>

#include "base/memory/scoped_refptr.h"
#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/time/time.h"
#include "base/values.h"
#include "base/timer/timer.h"
#include "components/domicile/browser/shortcut_registry.h"
#include "components/domicile/mojom/control_channel.mojom.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "net/base/io_buffer.h"
#include "net/socket/unix_domain_client_socket_posix.h"

namespace domicile {

// The shell's control channel, in the browser process.
//
// Speaks newline-delimited JSON over the compositor's unix control socket --
// the same protocol the deleted WebSocket bridge carried, byte for byte, so
// the compositor did not have to change. What changed is who may speak it: a
// mojo interface bound for the shell's origin, rather than a TCP port every
// process on the machine could reach.
class ControlChannel : public mojom::ControlChannel {
 public:
  // `socket_path` is the compositor's --chrome-socket. `client` is how
  // messages coming the other way reach the page.
  // Owns its own receiver and deletes itself when either end goes away. The
  // page's end is closed if the compositor never turns up, which is the only
  // way a shell can tell: resetting just the client remote silences the inbound
  // direction and leaves the page holding a channel that looks alive and
  // swallows everything written to it.
  ControlChannel(const std::string& socket_path,
                 mojo::PendingReceiver<mojom::ControlChannel> receiver);

  ControlChannel(const ControlChannel&) = delete;
  ControlChannel& operator=(const ControlChannel&) = delete;

  ~ControlChannel() override;

  // mojom::ControlChannel:
  void SetClient(
      mojo::PendingRemote<mojom::ControlChannelClient> client) override;
  void Spawn(const std::vector<std::string>& command) override;
  void FocusApp(const std::string& app_id) override;
  void FocusChrome() override;
  void CloseApp(const std::string& app_id) override;
  void ResizeApp(const std::string& app_id,
                 double width,
                 double height) override;
  void SetDesktopSize(double width, double height) override;
  void SetDevicePixelRatio(double ratio) override;
  void GrabShortcut(mojom::ShortcutPtr shortcut) override;
  void Key(const std::string& app_id, uint32_t keycode, bool pressed) override;
  void PointerMotion(const std::string& app_id, double x, double y) override;
  void PointerLeave(const std::string& app_id) override;
  void PointerButton(const std::string& app_id,
                     uint32_t button,
                     bool pressed) override;
  void PointerAxis(const std::string& app_id,
                   double dx,
                   double dy,
                   int32_t v120_x,
                   int32_t v120_y) override;

 private:
  // THE SOCKET IS EXPECTED TO BE MISSING AT FIRST, AND THAT IS THE LAUNCH
  // ORDER RATHER THAN A FAULT. The browser has to be running before the
  // compositor can connect to it as a producer, so the shell is loaded -- and
  // this channel opened -- while the compositor is still starting. Giving up on
  // the first ENOENT would hand every shell a dead channel on every launch.
  //
  // Bounded, because a page that will never have a compositor should find out
  // rather than sit there. These are the deleted bridge's numbers, kept so the
  // behaviour a shell sees does not change with the transport under it.
  static constexpr base::TimeDelta kReachFor = base::Seconds(30);
  static constexpr base::TimeDelta kRetryEvery = base::Milliseconds(50);

  // The version this speaks in `hello`. Must match the SDK's PROTOCOL_VERSION;
  // a mismatch is what `welcome` exists to catch.
  static constexpr int kProtocolVersion = 1;

  void Connect();
  void OnConnect(int result);
  void OnConnectFailed();

  // Serialise a dict and queue it. Every outbound member funnels through here,
  // so the framing and the queueing exist once rather than seventeen times.
  void SendMessage(base::DictValue message);
  void Send(const std::string& json_line);
  void FlushQueue();
  void WriteNext();
  void OnWrite(int result);

  // The registry's two deliveries, on this channel's own sequence. Both are
  // registered wrapped in base::BindPostTask, because a press is matched on the
  // UI thread and `client_` is a mojo remote bound to the IO thread.
  // `arrival` is when this process had the press, which for these two is not
  // always a socket read: a chord the shell claimed is matched here by
  // ShortcutRegistry and never crosses the compositor's socket. The socket
  // arms pass the read's stamp; the registry's callbacks take one at the match.
  // Same clock either way, which is what makes the page's subtraction mean
  // something.
  void DeliverShortcut(Chord chord, base::TimeTicks arrival);
  void DeliverModifiers(Modifiers modifiers, base::TimeTicks arrival);
  void DeliverShortcutNow(Chord chord);
  void DeliverModifiersNow(Modifiers modifiers);

  void ReadLoop();
  void OnRead(int result);
  // One complete line off the socket, with the moment the bytes arrived.
  // Anything unparseable is dropped with a log rather than closing the channel:
  // a message this build does not know about is a compositor newer than it, not
  // a broken stream.
  //
  // THE STAMP IS TAKEN ONCE PER READ, NOT ONCE PER LINE. A read can carry
  // several messages, and stamping each as it is parsed would price this
  // function's own JSON parse into the second and later ones -- so a batch
  // would read as a hop that grew with its position in the batch. What the
  // page is being told is when the browser process had the bytes, which is one
  // moment for all of them.
  void DispatchLine(const std::string& line, base::TimeTicks arrival);

  const std::string socket_path_;
  mojo::Receiver<mojom::ControlChannel> receiver_;
  mojo::Remote<mojom::ControlChannelClient> client_;

  // This page's registration with the process's shortcut registry, given back
  // in the destructor. The claims it made are not: the desktop's keys stay the
  // desktop's across a reload, and a gap between the two is a chord delivered
  // to whatever window is focused instead.
  ShortcutRegistry::ChannelId channel_;

  std::unique_ptr<net::UnixDomainClientSocket> socket_;
  bool connected_ = false;

  base::TimeTicks give_up_at_;
  base::OneShotTimer retry_timer_;

  // What the page said before the socket existed, in order. The deleted bridge
  // queued these too, and dropping them instead would lose exactly the messages
  // a shell sends at startup.
  std::vector<std::string> pending_;
  bool writing_ = false;
  std::string write_buffer_;
  size_t write_offset_ = 0;

  scoped_refptr<net::IOBuffer> read_buffer_;
  std::string read_remainder_;

  base::WeakPtrFactory<ControlChannel> weak_factory_{this};
};

// Bind a control channel for a frame, reading the compositor's socket path off
// the command line. Self-owned: it lives as long as the pipe does.
//
// THIS IS NOT THE ACCESS CONTROL. The caller decides who may reach it, and
// that decision -- registering the interface only for a document whose origin
// is domicile:// -- is the whole of the security property. See
// PopulateChromeFrameBinders.
void BindControlChannel(
    mojo::PendingReceiver<mojom::ControlChannel> receiver);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_CONTROL_CHANNEL_H_
