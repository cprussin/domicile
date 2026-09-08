// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/control_channel.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/values.h"
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
    mojo::PendingRemote<mojom::ControlChannelClient> client)
    : socket_path_(socket_path),
      client_(std::move(client)),
      read_buffer_(base::MakeRefCounted<net::IOBufferWithSize>(
          kReadBufferSize)) {
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
    return;
  }
  retry_timer_.Start(FROM_HERE, kRetryEvery,
                     base::BindOnce(&ControlChannel::Connect,
                                    weak_factory_.GetWeakPtr()));
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

  // Every other message type is one this slice has not implemented yet. Dropped
  // rather than fatal: the other 27 members land here, and until they do a
  // compositor sending them is ahead of this build rather than wrong.
}

}  // namespace domicile
