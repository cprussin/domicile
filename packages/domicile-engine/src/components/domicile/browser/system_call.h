// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SYSTEM_CALL_H_
#define COMPONENTS_DOMICILE_BROWSER_SYSTEM_CALL_H_

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/values.h"

namespace domicile {

// The shell's system calls, relayed between the page and the compositor
// without reading them. See docs/SHELL-SYSTEM-ACCESS.md.
//
// The compositor checks every call, the lock included. The browser only makes
// sure a page's call stays a system call: the page writes the request, and
// this writes the line around it.

// The `system_request` line for the page's call `id`, or nothing when
// `request` is not a JSON object with a string `call`, or `id` is above
// 2^31 - 1.
std::optional<std::string> SystemRequestLine(uint32_t id,
                                             std::string_view request);

// Whether a compositor line of this `type` answers a system call, and so goes
// to the page as it arrived.
bool IsSystemAnswer(std::string_view type);

// A page's temporary change to the desk's config, the line the compositor
// takes: `request` itself when it is a JSON object whose `type` is
// `set_config_override`, `reset_config_overrides` or
// `which_config_overrides`, and nothing otherwise. The compositor checks the
// rest and answers with a `config_overrides` line. See
// docs/SETTINGS.md#temporary-changes.
std::optional<std::string> ConfigChangeLine(std::string_view request);

// Whether a compositor line of this `type` answers a ConfigChangeLine, and so
// goes to the page as it arrived.
bool IsConfigChangeAnswer(std::string_view type);

// Whether `line` asks one compositor for its answer: a `system_request` or a
// ConfigChangeLine. One queued for a compositor that hung up is dropped, since
// the page hears that it ended (OpenCalls::EndAll, and a refused
// `config_overrides` for a config change), so the next compositor must not
// answer it too.
bool IsAskedOfOneCompositor(std::string_view line);

// The page's system calls one compositor has, so that a compositor that hangs
// up can end them for the page. The SDK sends a watch or a D-Bus match ended
// this way again. See "A compositor restart" in
// docs/architecture/ENGINE-FORK.md.
class OpenCalls {
 public:
  OpenCalls();
  OpenCalls(const OpenCalls&) = delete;
  OpenCalls& operator=(const OpenCalls&) = delete;
  ~OpenCalls();

  // The page called `id`. Only a new id is a new call: a page drives a running
  // one -- `unwatch`, `stdin` -- under the id it started it with.
  void Called(uint32_t id);

  // A line from the compositor. A `started` reply keeps its call open; any
  // other reply or an end closes it.
  void Heard(const base::DictValue& message);

  // A line per open call that ends it with `compositor_gone`, and forgets
  // them all: a `system_reply` for a call still waiting for its reply, which
  // is what the SDK awaits, and a `system_end` for one that `started`.
  std::vector<std::string> EndAll();

 private:
  // By id, with whether each has `started`.
  std::map<uint32_t, bool> calls_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SYSTEM_CALL_H_
