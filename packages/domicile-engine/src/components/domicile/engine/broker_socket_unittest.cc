// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/broker_socket.h"

#include <fcntl.h>
#include <sys/socket.h>
#include <sys/un.h>

#include <string>

#include "base/files/file_path.h"
#include "base/containers/span.h"
#include "base/files/scoped_file.h"
#include "base/files/scoped_temp_dir.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// A socket listening at `path`, as the browser's broker does.
base::ScopedFD ListenAt(const std::string& path) {
  sockaddr_un address = {.sun_family = AF_UNIX};
  base::span(address.sun_path).copy_prefix_from(base::span(path));
  base::ScopedFD fd(socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0));
  EXPECT_EQ(bind(fd.get(), reinterpret_cast<sockaddr*>(&address),
                 sizeof(address)),
            0);
  EXPECT_EQ(listen(fd.get(), 1), 0);
  return fd;
}

// A process the compositor starts must not hold the connection, or the
// browser never hears the compositor go.
TEST(BrokerSocketTest, TheConnectionClosesOnExec) {
  base::ScopedTempDir dir;
  ASSERT_TRUE(dir.CreateUniqueTempDir());
  const std::string path = dir.GetPath().Append("broker").value();
  const base::ScopedFD listening = ListenAt(path);

  const mojo::PlatformChannelEndpoint endpoint = ConnectToBroker(path);

  ASSERT_TRUE(endpoint.is_valid());
  EXPECT_TRUE(fcntl(endpoint.platform_handle().GetFD().get(), F_GETFD) &
              FD_CLOEXEC);
}

// Mojo reads until the socket would block, so a blocking one stalls the IO
// thread, and with it every frame, once nothing is left to read.
TEST(BrokerSocketTest, TheConnectionNeverBlocks) {
  base::ScopedTempDir dir;
  ASSERT_TRUE(dir.CreateUniqueTempDir());
  const std::string path = dir.GetPath().Append("broker").value();
  const base::ScopedFD listening = ListenAt(path);

  const mojo::PlatformChannelEndpoint endpoint = ConnectToBroker(path);

  ASSERT_TRUE(endpoint.is_valid());
  EXPECT_TRUE(fcntl(endpoint.platform_handle().GetFD().get(), F_GETFL) &
              O_NONBLOCK);
}

TEST(BrokerSocketTest, NothingListeningIsNoConnection) {
  base::ScopedTempDir dir;
  ASSERT_TRUE(dir.CreateUniqueTempDir());

  EXPECT_FALSE(
      ConnectToBroker(dir.GetPath().Append("broker").value()).is_valid());
}

}  // namespace
}  // namespace domicile
