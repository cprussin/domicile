// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/broker_socket.h"

#include <sys/socket.h>
#include <sys/un.h>

#include <utility>

#include "base/check_op.h"
#include "base/containers/span.h"
#include "base/files/scoped_file.h"
#include "base/logging.h"
#include "base/posix/eintr_wrapper.h"
#include "mojo/public/cpp/platform/platform_handle.h"

namespace domicile {

mojo::PlatformChannelEndpoint ConnectToBroker(const std::string& path) {
  sockaddr_un address = {.sun_family = AF_UNIX};
  CHECK_LT(path.size(), sizeof(address.sun_path))
      << "domicile: the broker socket path is too long: " << path;
  base::span(address.sun_path).copy_prefix_from(base::span(path));

  // Non-blocking, as mojo's channel reads until the socket would block: a
  // blocking one stalls the IO thread on the first read with nothing waiting.
  base::ScopedFD fd(
      socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0));
  PCHECK(fd.is_valid()) << "domicile: cannot make a socket for the broker";
  if (HANDLE_EINTR(connect(fd.get(), reinterpret_cast<sockaddr*>(&address),
                           sizeof(address))) != 0) {
    PLOG(ERROR) << "domicile: cannot connect to the broker at " << path;
    return mojo::PlatformChannelEndpoint();
  }
  return mojo::PlatformChannelEndpoint(mojo::PlatformHandle(std::move(fd)));
}

}  // namespace domicile
