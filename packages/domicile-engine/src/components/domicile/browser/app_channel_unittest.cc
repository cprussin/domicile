// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/app_channel.h"

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/files/scoped_temp_dir.h"
#include "base/functional/bind.h"
#include "base/memory/scoped_refptr.h"
#include "base/run_loop.h"
#include "base/test/repeating_test_future.h"
#include "base/test/task_environment.h"
#include "base/test/test_future.h"
#include "components/domicile/browser/line_framer.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "net/base/io_buffer.h"
#include "net/base/net_errors.h"
#include "net/socket/stream_socket.h"
#include "net/socket/unix_domain_server_socket_posix.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

class FakeClient : public mojom::AppChannelClient {
 public:
  mojo::PendingRemote<mojom::AppChannelClient> BindRemote() {
    return receiver_.BindNewPipeAndPassRemote();
  }

  void System(const std::string& message) override { heard_.AddValue(message); }

  base::test::RepeatingTestFuture<std::string> heard_;

 private:
  mojo::Receiver<mojom::AppChannelClient> receiver_{this};
};

// The result of a net call that may finish now or later.
int Settle(int result, base::test::TestFuture<int>& later) {
  return result == net::ERR_IO_PENDING ? later.Get() : result;
}

class AppChannelTest : public testing::Test {
 protected:
  void SetUp() override {
    ASSERT_TRUE(dir_.CreateUniqueTempDir());
    const std::string path = dir_.GetPath().Append("control").value();
    ASSERT_EQ(server_.BindAndListen(path, /*backlog=*/1), net::OK);

    // Self-owned: dropping `channel_` deletes it.
    new AppChannel(path, channel_.BindNewPipeAndPassReceiver());

    AcceptTheNextCompositor();
  }

  void AcceptTheNextCompositor() {
    base::test::TestFuture<int> accepted;
    ASSERT_EQ(
        Settle(server_.Accept(&compositor_, accepted.GetCallback()), accepted),
        net::OK);
  }

  void TearDown() override {
    channel_.reset();
    base::RunLoop().RunUntilIdle();
  }

  // Writes `lines` to the channel as the compositor.
  void Say(const std::string& lines) {
    auto buffer = base::MakeRefCounted<net::StringIOBuffer>(lines);
    base::test::TestFuture<int> written;
    ASSERT_EQ(Settle(compositor_->Write(buffer.get(), buffer->size(),
                                        written.GetCallback(),
                                        MISSING_TRAFFIC_ANNOTATION),
                     written),
              buffer->size());
  }

  // The next line the channel wrote, as the compositor reads it.
  std::string Heard() {
    while (lines_.empty()) {
      auto buffer = base::MakeRefCounted<net::IOBufferWithSize>(4096);
      base::test::TestFuture<int> read;
      const int got = Settle(
          compositor_->Read(buffer.get(), buffer->size(), read.GetCallback()),
          read);
      EXPECT_GT(got, 0);
      if (got <= 0) {
        return "";
      }
      for (std::string& line : framer_.Take(
               std::string_view(buffer->data(), static_cast<size_t>(got)))) {
        lines_.push_back(std::move(line));
      }
    }
    std::string line = std::move(lines_.front());
    lines_.erase(lines_.begin());
    return line;
  }

  base::test::SingleThreadTaskEnvironment task_environment_{
      base::test::TaskEnvironment::MainThreadType::IO};
  base::ScopedTempDir dir_;
  net::UnixDomainServerSocket server_{
      base::BindRepeating(
          [](const net::UnixDomainServerSocket::Credentials&) { return true; }),
      /*use_abstract_namespace=*/false};
  std::unique_ptr<net::StreamSocket> compositor_;
  mojo::Remote<mojom::AppChannel> channel_;
  LineFramer framer_;
  std::vector<std::string> lines_;
  FakeClient client_;
};

// The compositor tells an app's connection from a shell's by this, and
// answers it only the calls an app may make.
TEST_F(AppChannelTest, SaysItIsAnApp) {
  EXPECT_EQ(Heard(), R"({"protocol_version":1,"type":"app_hello"})");
}

TEST_F(AppChannelTest, RelaysACallAndItsAnswer) {
  channel_->SetClient(client_.BindRemote());
  channel_->CallSystem(7, R"({"call":"stat","path":"/tmp"})");
  Heard();
  EXPECT_EQ(Heard(),
            R"({"id":7,"request":{"call":"stat","path":"/tmp"},)"
            R"("type":"system_request"})");

  // The welcome is the channel's, not the page's.
  Say("{\"type\":\"welcome\",\"protocol_version\":1}\n"
      "{\"type\":\"system_end\",\"id\":7}\n");
  EXPECT_EQ(client_.heard_.Take(), "{\"type\":\"system_end\",\"id\":7}");
}

// A compositor that exits takes the app's calls with it, and the channel dials
// the next one. The SDK sends a watch ended this way again. See "A compositor
// restart" in docs/architecture/ENGINE-FORK.md.
TEST_F(AppChannelTest, ACompositorThatHangsUpEndsItsCallsAndIsReplaced) {
  channel_->SetClient(client_.BindRemote());
  channel_->CallSystem(3, R"({"call":"watch","path":"/tmp"})");
  channel_->CallSystem(4, R"({"call":"stat","path":"/tmp"})");
  Heard();
  Heard();
  Heard();
  Say("{\"type\":\"system_reply\",\"id\":3,\"reply\":"
      "{\"kind\":\"started\"}}\n");
  client_.heard_.Take();

  compositor_.reset();

  EXPECT_EQ(
      client_.heard_.Take(),
      R"({"end":{"error":{"kind":"compositor_gone","message":"the )"
      R"(compositor exited"},"kind":"failed"},"id":3,"type":"system_end"})");
  EXPECT_EQ(
      client_.heard_.Take(),
      R"({"id":4,"reply":{"error":{"kind":"compositor_gone","message":)"
      R"("the compositor exited"},"kind":"failed"},"type":"system_reply"})");

  AcceptTheNextCompositor();
  EXPECT_EQ(Heard(), R"({"protocol_version":1,"type":"app_hello"})");
  channel_->CallSystem(5, R"({"call":"watch","path":"/tmp"})");
  EXPECT_EQ(Heard(),
            R"({"id":5,"request":{"call":"watch","path":"/tmp"},)"
            R"("type":"system_request"})");
}

}  // namespace
}  // namespace domicile
