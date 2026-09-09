// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/control_channel.h"

#include <utility>

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/values.h"
#include "components/domicile/common/domicile_scheme.h"
#include "net/base/net_errors.h"

namespace domicile {
namespace {

// The read buffer. One message is a line of JSON; this is sized for a batch of
// them rather than for the largest one, because the remainder is carried across
// reads anyway.
constexpr int kReadBufferSize = 16 * 1024;

}  // namespace

ControlChannel::ControlChannel(
    const std::string& socket_path,
    mojo::PendingReceiver<mojom::ControlChannel> receiver)
    : socket_path_(socket_path),
      receiver_(this, std::move(receiver)),
      read_buffer_(base::MakeRefCounted<net::IOBufferWithSize>(
          kReadBufferSize)) {
  // The page going away takes this with it; nothing else owns it.
  receiver_.set_disconnect_handler(
      base::BindOnce([](ControlChannel* self) { delete self; },
                     base::Unretained(this)));
  give_up_at_ = base::TimeTicks::Now() + kReachFor;
  Connect();
}

ControlChannel::~ControlChannel() = default;

void ControlChannel::Connect() {
  socket_ = std::make_unique<net::UnixDomainClientSocket>(
      socket_path_, /*use_abstract_namespace=*/false);
  const int result = socket_->Connect(base::BindOnce(
      &ControlChannel::OnConnect, weak_factory_.GetWeakPtr()));
  if (result != net::ERR_IO_PENDING) {
    OnConnect(result);
  }
}

void ControlChannel::OnConnect(int result) {
  if (result != net::OK) {
    OnConnectFailed();
    return;
  }

  connected_ = true;

  // The handshake, which the page used to send and the browser now owns. A
  // compositor that disagrees about the version says so in `welcome`, and that
  // is the check this exists for.
  base::DictValue hello;
  hello.Set("type", "hello");
  hello.Set("protocol_version", kProtocolVersion);
  std::string line;
  if (base::JSONWriter::Write(hello, &line)) {
    pending_.insert(pending_.begin(), line);
  }

  ReadLoop();
  FlushQueue();
}

void ControlChannel::OnConnectFailed() {
  socket_.reset();
  if (base::TimeTicks::Now() >= give_up_at_) {
    // Say so rather than sit there. A shell whose channel never connected has
    // no desktop behind it, and silence is the failure mode ERRORS.md exists to
    // prevent.
    LOG(ERROR) << "domicile: no compositor on " << socket_path_ << " after "
               << kReachFor.InSeconds()
               << "s. The desktop's control channel will not connect; the "
                  "shell will render but no window will work.";
    client_.reset();
    // Closing the page's end is what makes the failure visible. `this` is
    // destroyed by the disconnect handler, so nothing may touch it after.
    receiver_.reset();
    delete this;
    return;
  }
  retry_timer_.Start(FROM_HERE, kRetryEvery,
                     base::BindOnce(&ControlChannel::Connect,
                                    weak_factory_.GetWeakPtr()));
}

void ControlChannel::SetClient(
    mojo::PendingRemote<mojom::ControlChannelClient> client) {
  client_.Bind(std::move(client));
}

void ControlChannel::Spawn(const std::vector<std::string>& command) {
  // An empty argv is refused here as well as in the renderer, because the
  // renderer's check is advice: this process is the one that must not hand an
  // empty command to the compositor.
  if (command.empty()) {
    return;
  }

  base::ListValue argv;
  for (const std::string& argument : command) {
    argv.Append(argument);
  }
  base::DictValue message;
  message.Set("type", "spawn");
  message.Set("command", std::move(argv));

  std::string line;
  if (!base::JSONWriter::Write(message, &line)) {
    return;
  }
  Send(line);
}

void ControlChannel::SendMessage(base::DictValue message) {
  std::string line;
  if (!base::JSONWriter::Write(message, &line)) {
    return;
  }
  Send(line);
}

namespace {

base::DictValue Typed(const char* type) {
  base::DictValue message;
  message.Set("type", type);
  return message;
}

base::DictValue ForApp(const char* type, const std::string& app_id) {
  base::DictValue message = Typed(type);
  message.Set("app_id", app_id);
  return message;
}

}  // namespace

void ControlChannel::FocusApp(const std::string& app_id) {
  SendMessage(ForApp("focus_app", app_id));
}

void ControlChannel::FocusChrome() {
  SendMessage(Typed("focus_chrome"));
}

void ControlChannel::CloseApp(const std::string& app_id) {
  SendMessage(ForApp("close_app", app_id));
}

void ControlChannel::ResizeApp(const std::string& app_id,
                               uint32_t width,
                               uint32_t height) {
  base::DictValue message = ForApp("resize_app", app_id);
  base::ListValue size;
  size.Append(static_cast<int>(width));
  size.Append(static_cast<int>(height));
  message.Set("size", std::move(size));
  SendMessage(std::move(message));
}

void ControlChannel::SetDesktopSize(uint32_t width, uint32_t height) {
  base::DictValue message = Typed("set_desktop_size");
  base::ListValue size;
  size.Append(static_cast<int>(width));
  size.Append(static_cast<int>(height));
  message.Set("size", std::move(size));
  SendMessage(std::move(message));
}

void ControlChannel::SetDevicePixelRatio(double ratio) {
  base::DictValue message = Typed("set_device_pixel_ratio");
  message.Set("ratio", ratio);
  SendMessage(std::move(message));
}

void ControlChannel::GrabShortcut(const std::string& shortcut) {
  base::DictValue message = Typed("grab_shortcut");
  message.Set("shortcut", shortcut);
  SendMessage(std::move(message));
}

void ControlChannel::Key(const std::string& app_id,
                         uint32_t keycode,
                         bool pressed) {
  base::DictValue message = ForApp("key", app_id);
  message.Set("keycode", static_cast<int>(keycode));
  message.Set("pressed", pressed);
  SendMessage(std::move(message));
}

void ControlChannel::PointerMotion(const std::string& app_id,
                                   double x,
                                   double y) {
  base::DictValue message = ForApp("pointer_motion", app_id);
  message.Set("x", x);
  message.Set("y", y);
  SendMessage(std::move(message));
}

void ControlChannel::PointerLeave(const std::string& app_id) {
  SendMessage(ForApp("pointer_leave", app_id));
}

void ControlChannel::PointerButton(const std::string& app_id,
                                   uint32_t button,
                                   bool pressed) {
  base::DictValue message = ForApp("pointer_button", app_id);
  message.Set("button", static_cast<int>(button));
  message.Set("pressed", pressed);
  SendMessage(std::move(message));
}

void ControlChannel::PointerAxis(const std::string& app_id,
                                 double dx,
                                 double dy,
                                 int32_t v120_x,
                                 int32_t v120_y) {
  base::DictValue message = ForApp("pointer_axis", app_id);
  message.Set("dx", dx);
  message.Set("dy", dy);
  message.Set("v120_x", v120_x);
  message.Set("v120_y", v120_y);
  SendMessage(std::move(message));
}

void ControlChannel::Send(const std::string& json_line) {
  pending_.push_back(json_line);
  if (connected_) {
    FlushQueue();
  }
}

void ControlChannel::FlushQueue() {
  if (!connected_ || writing_ || pending_.empty()) {
    return;
  }
  WriteNext();
}

void ControlChannel::WriteNext() {
  if (pending_.empty()) {
    writing_ = false;
    return;
  }
  writing_ = true;
  write_buffer_ = pending_.front() + "\n";
  pending_.erase(pending_.begin());
  write_offset_ = 0;
  OnWrite(net::OK);
}

void ControlChannel::OnWrite(int result) {
  if (result < 0) {
    LOG(ERROR) << "domicile: control channel write failed: "
               << net::ErrorToString(result);
    writing_ = false;
    return;
  }
  write_offset_ += static_cast<size_t>(result);
  if (write_offset_ >= write_buffer_.size()) {
    WriteNext();
    return;
  }

  auto remaining = base::MakeRefCounted<net::StringIOBuffer>(
      write_buffer_.substr(write_offset_));
  const int written = socket_->Write(
      remaining.get(), remaining->size(),
      base::BindOnce(&ControlChannel::OnWrite, weak_factory_.GetWeakPtr()),
      MISSING_TRAFFIC_ANNOTATION);
  if (written != net::ERR_IO_PENDING) {
    OnWrite(written);
  }
}

void ControlChannel::ReadLoop() {
  const int result = socket_->Read(
      read_buffer_.get(), kReadBufferSize,
      base::BindOnce(&ControlChannel::OnRead, weak_factory_.GetWeakPtr()));
  if (result != net::ERR_IO_PENDING) {
    OnRead(result);
  }
}

void ControlChannel::OnRead(int result) {
  if (result <= 0) {
    // Zero is the compositor closing the socket, which on this desktop means
    // it went away. Either way there is nothing more to read and nothing to
    // send it.
    connected_ = false;
    client_.reset();
    return;
  }

  read_remainder_.append(read_buffer_->data(), static_cast<size_t>(result));

  size_t newline = read_remainder_.find('\n');
  while (newline != std::string::npos) {
    DispatchLine(read_remainder_.substr(0, newline));
    read_remainder_.erase(0, newline + 1);
    newline = read_remainder_.find('\n');
  }

  ReadLoop();
}

void ControlChannel::DispatchLine(const std::string& line) {
  if (line.empty() || !client_) {
    return;
  }

  std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  if (!parsed) {
    LOG(WARNING) << "domicile: control channel sent a line that is not a JSON "
                    "object; dropped.";
    return;
  }
  const base::DictValue& message = *parsed;
  const std::string* type = message.FindString("type");
  if (!type) {
    return;
  }

  if (*type == "welcome") {
    const std::optional<int> version = message.FindInt("protocol_version");
    if (version && *version != kProtocolVersion) {
      LOG(ERROR) << "domicile: the compositor speaks protocol version "
                 << *version << " and this engine speaks " << kProtocolVersion
                 << ". They were built from different revisions; the desktop "
                    "will misbehave in ways that look like bugs.";
    }
    return;
  }

  if (*type == "app_titled") {
    const std::string* app_id = message.FindString("app_id");
    const std::string* title = message.FindString("title");
    if (app_id && title) {
      client_->AppTitled(*app_id, *title);
    }
    return;
  }

  if (*type == "app_appeared") {
    const std::string* app_id = message.FindString("app_id");
    if (!app_id) {
      return;
    }
    const std::string* title = message.FindString("title");
    // Size is absent until the client has committed a buffer. Passing a zero
    // as though it were a size is what opened windows at nothing at all, so
    // absence is carried rather than flattened.
    const base::ListValue* size = message.FindList("size");
    const bool has_size = size && size->size() == 2u;
    client_->AppAppeared(
        *app_id, title ? *title : std::string(), has_size,
        has_size ? static_cast<uint32_t>((*size)[0].GetIfInt().value_or(0)) : 0u,
        has_size ? static_cast<uint32_t>((*size)[1].GetIfInt().value_or(0)) : 0u);
    return;
  }

  if (*type == "app_resized") {
    const std::string* app_id = message.FindString("app_id");
    const base::ListValue* size = message.FindList("size");
    if (app_id && size && size->size() == 2u) {
      client_->AppResized(
          *app_id, static_cast<uint32_t>((*size)[0].GetIfInt().value_or(0)),
          static_cast<uint32_t>((*size)[1].GetIfInt().value_or(0)));
    }
    return;
  }

  if (*type == "app_closed") {
    if (const std::string* app_id = message.FindString("app_id")) {
      client_->AppClosed(*app_id);
    }
    return;
  }

  if (*type == "app_cursor") {
    const std::string* app_id = message.FindString("app_id");
    const std::string* cursor = message.FindString("cursor");
    if (app_id && cursor) {
      client_->AppCursor(*app_id, *cursor);
    }
    return;
  }

  if (*type == "shortcut") {
    if (const std::string* shortcut = message.FindString("shortcut")) {
      client_->Shortcut(*shortcut);
    }
    return;
  }

  if (*type == "modifiers") {
    client_->Modifiers(
        static_cast<uint32_t>(message.FindInt("depressed").value_or(0)),
        static_cast<uint32_t>(message.FindInt("latched").value_or(0)),
        static_cast<uint32_t>(message.FindInt("locked").value_or(0)),
        static_cast<uint32_t>(message.FindInt("group").value_or(0)));
    return;
  }

  if (*type == "focus_changed") {
    // Empty app_id means the chrome itself has focus, which is a state rather
    // than a missing field.
    const std::string* app_id = message.FindString("app_id");
    client_->FocusChanged(app_id ? *app_id : std::string());
    return;
  }

  // What is left is the bands and copy-path protocol -- place_portal,
  // render_band, app_composited and their kin. Deliberately not implemented:
  // docs/architecture/ENGINE-FORK.md lists them under what the fork scraps,
  // because layout positions the layer now and the page has stopped reporting
  // where its own boxes are. Cementing them here would make a dying protocol
  // cost an engine release to remove.
}

void BindControlChannel(
    mojo::PendingReceiver<mojom::ControlChannel> receiver) {
  const std::string socket_path =
      base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(
          kDomicileControlSocketSwitch);
  if (socket_path.empty()) {
    // No socket means the engine was started without --domicile-control-socket.
    // Dropping the receiver closes the page's end, so a shell finds out rather
    // than talking into a channel that goes nowhere.
    LOG(ERROR) << "domicile: a page asked for the control channel but the "
                  "engine was started without --domicile-control-socket. The "
                  "shell will load and no window will respond.";
    return;
  }
  // Owns itself: it lives until the page drops the pipe or the compositor is
  // declared unreachable.
  new ControlChannel(socket_path, std::move(receiver));
}

}  // namespace domicile
