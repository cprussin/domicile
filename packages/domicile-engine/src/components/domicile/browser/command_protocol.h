// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_COMMAND_PROTOCOL_H_
#define COMPONENTS_DOMICILE_BROWSER_COMMAND_PROTOCOL_H_

#include <string>
#include <string_view>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/functional/function_ref.h"
#include "base/types/expected.h"
#include "url/gurl.h"

namespace domicile {

// What a running engine can be told about the shell it serves, and what it
// answers. One JSON object per line, a request in and a reply out, and the
// connection is over.
//
//   {"type":"load_shell","version":1,"root":"/x/dist","module":"shell.js"}
//   -> {"type":"loaded"}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"open_url","version":1,"url":"https://example.com/"}
//   -> {"type":"opened"}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"screenshot","version":1,"file":"/home/me/shot.png"}
//   -> {"type":"captured"}
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

// Carries out a believed `open_url`: opens a browser window at `url`. Returns
// whether a shell existed to own the window, for LoadShell's reason. The shell
// places the window.
using OpenUrl = base::FunctionRef<bool(const GURL& url)>;

// How a screenshot ended: written, or why not.
using ScreenshotDone =
    base::OnceCallback<void(base::expected<void, std::string>)>;

// Carrying a believed `screenshot` out: write a PNG of the desk to `file`.
// Answers through `done` because the display compositor reads the desk back
// after this returns.
using Screenshot =
    base::FunctionRef<void(const base::FilePath& file, ScreenshotDone done)>;

// The reply line, with its trailing newline: the bytes to write.
using CommandReply = base::OnceCallback<void(std::string)>;

// Answer one request line, without its newline. `reply` runs once: before
// this returns for every command but `screenshot`, and when `screenshot`'s
// `done` runs for that one.
void AnswerCommand(std::string_view line,
                   LoadShell load_shell,
                   OpenUrl open_url,
                   Screenshot screenshot,
                   CommandReply reply);

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
