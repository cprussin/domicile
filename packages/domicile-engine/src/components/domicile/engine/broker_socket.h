// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_BROKER_SOCKET_H_
#define COMPONENTS_DOMICILE_ENGINE_BROKER_SOCKET_H_

#include <string>

#include "mojo/public/cpp/platform/platform_channel_endpoint.h"

namespace domicile {

// Connects to the browser's broker socket at `path`, or returns an invalid
// endpoint if nothing listens there.
//
// The fd is non-blocking, as mojo needs, and close-on-exec. mojo::NamedPlatformChannel's is not, since
// Chromium's own launches close every fd, so each process the compositor
// starts would inherit it: the browser then never sees the compositor go, and
// never listens for the next one.
mojo::PlatformChannelEndpoint ConnectToBroker(const std::string& path);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_ENGINE_BROKER_SOCKET_H_
