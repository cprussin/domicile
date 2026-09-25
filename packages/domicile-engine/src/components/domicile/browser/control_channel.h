// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

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
#include "components/domicile/browser/line_framer.h"
#include "components/domicile/browser/shortcut_registry.h"
#include "components/domicile/mojom/control_channel.mojom.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "net/base/io_buffer.h"
#include "net/socket/unix_domain_client_socket_posix.h"

namespace domicile {

// How a keymap off this channel reaches the engine that decodes keys with it.
//
// A callback rather than a call, because the two ends are on different
// threads: this channel is read on the IO thread and the keyboard layout
// engine belongs to the UI thread, along with every evdev key dispatched
// through it. The binder that constructs a ControlChannel runs on the UI
// thread, so it is the one that can bind SetProcessKeymap to it -- and this
// target stays free of //content, which is where a task runner would otherwise
// have to come from. See components/domicile/browser/keyboard_layout.h.
using KeymapSink = base::RepeatingCallback<void(const std::string&)>;

// How a `warp_pointer` off this channel reaches the cursor it is about.
//
// A callback for KeymapSink's reason and one more. The reason: this channel is
// read on the IO thread and a cursor belongs to the UI thread, along with the
// window it is moved within -- so the binder, which runs on the UI thread,
// binds this to it. The one more: THE CURSOR IS NOT THE COMPOSITOR'S HERE.
// This message reaches no socket at all; the browser process draws the pointer
// and the browser process moves it, which is why what the page asked for stops
// in a callback rather than in a line of JSON. A page's own coordinates, in
// CSS pixels, so this target stays free of //ui and of the window the point is
// clamped into. See components/domicile/browser/pointer_warp.h.
using PointerWarpSink = base::RepeatingCallback<void(double x, double y)>;

// How the desktop's theme reaches the color scheme every page in this process
// is drawn in. A callback for KeymapSink's reason: NativeTheme belongs to the
// UI thread. See components/domicile/browser/color_scheme.h.
using ThemeSink = base::RepeatingCallback<void(mojom::Theme)>;

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
  // `screen` is the display this page's window covers, by the name the
  // compositor describes it under -- `drm-<id>` for the engine's own displays.
  // Empty where the window is the whole desktop, which is a nested run.
  ControlChannel(const std::string& socket_path,
                 mojo::PendingReceiver<mojom::ControlChannel> receiver,
                 KeymapSink keymap_sink,
                 PointerWarpSink warp_sink,
                 ThemeSink theme_sink,
                 const std::string& screen);

  ControlChannel(const ControlChannel&) = delete;
  ControlChannel& operator=(const ControlChannel&) = delete;

  ~ControlChannel() override;

  // mojom::ControlChannel:
  void SetClient(
      mojo::PendingRemote<mojom::ControlChannelClient> client) override;
  void Spawn(const std::vector<std::string>& command) override;
  void SearchFiles(const std::string& query) override;
  void PreviewFile(const std::string& path) override;
  void CopyClipboardEntry(uint32_t entry) override;
  void FocusApp(const std::string& app_id) override;
  void FocusChrome() override;
  void WarpPointer(double x, double y) override;
  void CloseApp(const std::string& app_id) override;
  void ResizeApp(const std::string& app_id,
                 double width,
                 double height) override;
  void SetDesktopSize(double width, double height) override;
  void SetDevicePixelRatio(double ratio) override;
  void SetTheme(mojom::Theme theme) override;
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
  // behavior a shell sees does not change with the transport under it.
  static constexpr base::TimeDelta kReachFor = base::Seconds(30);
  static constexpr base::TimeDelta kRetryEvery = base::Milliseconds(50);

  // The version this speaks in `hello`. Must match the SDK's PROTOCOL_VERSION;
  // a mismatch is what `welcome` exists to catch.
  static constexpr int kProtocolVersion = 1;

  void Connect();
  void OnConnect(int result);
  void OnConnectFailed();

  // Serialize a dict and queue it. Every outbound member funnels through here,
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
  const KeymapSink keymap_sink_;
  const PointerWarpSink warp_sink_;
  const ThemeSink theme_sink_;
  // The display this page's window covers, or empty for a window that is the
  // whole desktop. Stated to the compositor on connecting and never again: a
  // window does not move between monitors here, because it is created at one
  // display's bounds and closed when that display goes.
  const std::string screen_;
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
  LineFramer framer_;

  base::WeakPtrFactory<ControlChannel> weak_factory_{this};
};

// Bind a control channel for a frame, reading the compositor's socket path off
// the command line. Self-owned: it lives as long as the pipe does.
//
// THIS IS NOT THE ACCESS CONTROL. The caller decides who may reach it, and
// that decision -- registering the interface only for a document whose origin
// is domicile:// -- is the whole of the security property. See
// PopulateChromeFrameBinders.
void BindControlChannel(mojo::PendingReceiver<mojom::ControlChannel> receiver,
                        KeymapSink keymap_sink,
                        PointerWarpSink warp_sink,
                        ThemeSink theme_sink,
                        const std::string& screen);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_CONTROL_CHANNEL_H_
