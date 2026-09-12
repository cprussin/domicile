// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_COMMAND_PROTOCOL_H_
#define COMPONENTS_DOMICILE_BROWSER_COMMAND_PROTOCOL_H_

#include <string>
#include <string_view>

#include "base/files/file_path.h"
#include "base/functional/function_ref.h"

namespace domicile {

// What a running engine can be told about the shell it serves, and what it
// answers. One JSON object per line, a request in and a reply out, and the
// connection is over.
//
//   {"type":"load_shell","version":1,"root":"/x/dist","module":"shell.js"}
//   -> {"type":"loaded"}
//   -> {"type":"refused","why":"..."}
//
// Newline-delimited JSON because that is already the framing in this system --
// the compositor serves the host protocol in it, the engine speaks it back,
// and the supervisor's own control socket answers it -- and a second framing
// would be a second thing to get right for no gain.
//
// This half is pure on purpose: a line of somebody else's bytes in, a line of
// ours out, and the one thing in between is injected. Getting those bytes on
// and off a socket is chrome/browser/domicile/domicile_command_socket.cc's,
// and is the part that cannot be tested with a string.

// THE VERSION, AND WHY THIS CONTRACT HAS ONE WHEN THE OTHER TWO DO NOT.
// `DATA.md` says to version a contract when producer and consumer can be on
// different releases at the same time. This one can: the supervisor and the
// engine are separately published deploy units -- `engine-release.nix` pins an
// engine built from an older commit than main, and moving to a newer one is
// its own reviewed commit -- so a desktop routinely runs a supervisor and an
// engine from different revisions. The host<->chrome protocol is pinned at 1
// for the opposite reason and the supervisor's own control socket carries no
// number at all, because both of those have two ends in one binary.
//
// It goes in the request rather than in a path, because the socket is named by
// the supervisor and bound by the engine -- there is no path to put it in --
// and every connection is exactly one request, so there is no handshake to
// negotiate it in either. The refusal is the check: an engine that does not
// speak the version it was sent says so, by name, on the socket the command
// came in on.
inline constexpr int kCommandVersion = 1;

// Carrying a believed `load_shell` out: serve this shell from now on, and put
// it on the screen. Answers whether there was a shell window to put it in --
// which is the one way applying a well-formed command can fail, and the reason
// this is a `bool` rather than nothing.
using LoadShell =
    base::FunctionRef<bool(const base::FilePath& root,
                           const std::string& module)>;

// Answer one request line, without its newline. The reply carries its own
// trailing newline, because what a caller wants is the bytes to write.
std::string AnswerCommand(std::string_view line, LoadShell load_shell);

// The reply for a request this engine will not carry out, given the reason a
// person should read.
//
// Public because the socket refuses on its own account as well: a peer that
// holds a connection open without ever ending a line is refused before there
// is a line to answer, and the refusal it gets should be the same shape as
// every other one.
std::string RefusedCommand(std::string_view why);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_COMMAND_PROTOCOL_H_
