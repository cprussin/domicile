// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/app_channel.h"

#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "base/check.h"
#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/task/sequenced_task_runner.h"
#include "base/values.h"
#include "components/domicile/browser/system_call.h"
#include "components/domicile/common/domicile_scheme.h"
#include "net/base/net_errors.h"
#include "net/traffic_annotation/network_traffic_annotation.h"

namespace domicile {
namespace {

// As ControlChannel's.
constexpr int kReadBufferSize = 16 * 1024;

// The version this speaks, as ControlChannel's `hello` does.
constexpr int kProtocolVersion = 1;

std::string AppHello() {
  base::DictValue hello;
  hello.Set("type", "app_hello");
  hello.Set("protocol_version", kProtocolVersion);
  std::string line;
  CHECK(base::JSONWriter::Write(hello, &line));
  return line;
}

}  // namespace

AppChannel::AppChannel(const std::string& socket_path,
                       mojo::PendingReceiver<mojom::AppChannel> receiver)
    : socket_path_(socket_path),
      receiver_(this, std::move(receiver)),
      read_buffer_(base::MakeRefCounted<net::IOBufferWithSize>(
          kReadBufferSize)) {
  receiver_.set_disconnect_handler(base::BindOnce(
      [](AppChannel* self) { delete self; }, base::Unretained(this)));
  give_up_at_ = base::TimeTicks::Now() + kReachFor;
  // Posted, so a connect that fails at once does not delete this before its
  // constructor returns.
  base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE,
      base::BindOnce(&AppChannel::Connect, weak_factory_.GetWeakPtr()));
}

AppChannel::~AppChannel() = default;

void AppChannel::Connect() {
  socket_ = std::make_unique<net::UnixDomainClientSocket>(
      socket_path_, /*use_abstract_namespace=*/false);
  const int result = socket_->Connect(
      base::BindOnce(&AppChannel::OnConnect, weak_factory_.GetWeakPtr()));
  if (result != net::ERR_IO_PENDING) {
    OnConnect(result);
  }
}

void AppChannel::OnConnect(int result) {
  if (result != net::OK) {
    socket_.reset();
    if (base::TimeTicks::Now() < give_up_at_) {
      retry_timer_.Start(
          FROM_HERE, kRetryEvery,
          base::BindOnce(&AppChannel::Connect, weak_factory_.GetWeakPtr()));
      return;
    }
    LOG(ERROR) << "domicile: an app's channel could not reach the compositor "
                  "in "
               << kReachFor.InSeconds() << "s: " << net::ErrorToString(result)
               << ". Its system calls will not be answered.";
    // Closing the page's end is what tells it. Nothing may touch `this` after.
    delete this;
    return;
  }
  connected_ = true;
  pending_.insert(pending_.begin(), AppHello());
  ReadLoop();
  WriteNext();
}

void AppChannel::OnHungUp() {
  connected_ = false;
  writing_ = false;
  socket_.reset();
  framer_ = std::make_unique<LineFramer>();
  // Only calls are queued, and EndAll ends each of them.
  pending_.clear();
  for (const std::string& line : calls_.EndAll()) {
    Answer(line);
  }
  LOG(WARNING) << "domicile: an app's compositor hung up; waiting "
               << kReachFor.InSeconds() << "s for the next one.";
  give_up_at_ = base::TimeTicks::Now() + kReachFor;
  Connect();
}

void AppChannel::SetClient(
    mojo::PendingRemote<mojom::AppChannelClient> client) {
  client_.Bind(std::move(client));
  std::vector<std::string> held;
  held.swap(held_);
  for (const std::string& line : held) {
    client_->System(line);
  }
}

// Wrapped rather than read: the compositor judges the call.
void AppChannel::CallSystem(uint32_t id, const std::string& request) {
  std::optional<std::string> line = SystemRequestLine(id, request);
  if (!line) {
    LOG(WARNING) << "domicile: an app's system call " << id
                 << " is not a JSON object with a `call`; it was dropped.";
    return;
  }
  calls_.Called(id);
  Send(std::move(*line));
}

void AppChannel::Send(std::string line) {
  pending_.push_back(std::move(line));
  WriteNext();
}

void AppChannel::WriteNext() {
  if (!connected_ || writing_ || pending_.empty()) {
    return;
  }
  writing_ = true;
  std::string line = std::move(pending_.front()) + "\n";
  pending_.erase(pending_.begin());
  const size_t size = line.size();
  write_buffer_ = base::MakeRefCounted<net::DrainableIOBuffer>(
      base::MakeRefCounted<net::StringIOBuffer>(std::move(line)), size);
  OnWrite(0);
}

void AppChannel::OnWrite(int result) {
  if (result < 0) {
    LOG(ERROR) << "domicile: an app's channel write failed: "
               << net::ErrorToString(result);
    writing_ = false;
    return;
  }
  write_buffer_->DidConsume(result);
  if (write_buffer_->BytesRemaining() == 0) {
    writing_ = false;
    WriteNext();
    return;
  }
  const int written = socket_->Write(
      write_buffer_.get(), write_buffer_->BytesRemaining(),
      base::BindOnce(&AppChannel::OnWrite, weak_factory_.GetWeakPtr()),
      MISSING_TRAFFIC_ANNOTATION);
  if (written != net::ERR_IO_PENDING) {
    OnWrite(written);
  }
}

void AppChannel::ReadLoop() {
  const int result = socket_->Read(
      read_buffer_.get(), kReadBufferSize,
      base::BindOnce(&AppChannel::OnRead, weak_factory_.GetWeakPtr()));
  if (result != net::ERR_IO_PENDING) {
    OnRead(result);
  }
}

void AppChannel::OnRead(int result) {
  if (result <= 0) {
    OnHungUp();
    return;
  }
  for (const std::string& line : framer_->Take(std::string_view(
           read_buffer_->data(), static_cast<size_t>(result)))) {
    DispatchLine(line);
  }
  ReadLoop();
}

void AppChannel::DispatchLine(const std::string& line) {
  const std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  const std::string* type = parsed ? parsed->FindString("type") : nullptr;
  if (type == nullptr || !IsSystemAnswer(*type)) {
    return;
  }
  calls_.Heard(*parsed);
  Answer(line);
}

void AppChannel::Answer(const std::string& line) {
  if (client_) {
    client_->System(line);
  } else {
    held_.push_back(line);
  }
}

void BindAppChannel(mojo::PendingReceiver<mojom::AppChannel> receiver) {
  const std::string socket_path =
      base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(
          kDomicileControlSocketSwitch);
  if (socket_path.empty()) {
    LOG(ERROR) << "domicile: an app asked for its channel but the engine was "
                  "started without --domicile-control-socket.";
    return;
  }
  // Owns itself.
  new AppChannel(socket_path, std::move(receiver));
}

}  // namespace domicile
