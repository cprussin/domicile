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

// The command protocol: requests a running engine accepts about the shell it
// serves. Each connection carries one JSON request line and one reply line.
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
// This file only parses and answers lines; the actions are injected so it can
// be tested with strings. chrome/browser/domicile/domicile_command_socket.cc
// owns the socket.

// The command protocol version.
//
// The supervisor and the engine ship separately (`engine-release.nix` pins the
// engine), so the two ends can run different revisions. Each request carries
// the version because there is no handshake. An engine that does not speak it
// refuses the request and names both versions.
inline constexpr int kCommandVersion = 1;

// Carries out `load_shell`: serves this shell and shows it. Returns false if
// there is no shell window to load it into.
using LoadShell =
    base::FunctionRef<bool(const base::FilePath& root,
                           const std::string& module)>;

// Carries out `open_url`: opens a browser window at `url`. Returns false if
// there is no shell to own the window.
using OpenUrl = base::FunctionRef<bool(const GURL& url)>;

// How a screenshot ended: written, or why not.
using ScreenshotDone =
    base::OnceCallback<void(base::expected<void, std::string>)>;

// Carries out `screenshot`: writes a PNG of the desk to `file`. Answers through
// `done` because the display compositor reads the desk back asynchronously.
using Screenshot =
    base::FunctionRef<void(const base::FilePath& file, ScreenshotDone done)>;

// Receives the reply line, including its trailing newline.
using CommandReply = base::OnceCallback<void(std::string)>;

// Answers one request line (without its newline). `reply` runs once:
// before this returns, except for `screenshot`, where it runs from `done`.
void AnswerCommand(std::string_view line,
                   LoadShell load_shell,
                   OpenUrl open_url,
                   Screenshot screenshot,
                   CommandReply reply);

// Returns the refusal reply line for `why`.
//
// Public so the socket can refuse a peer that never ends a line with the same
// reply shape.
std::string RefusedCommand(std::string_view why);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_COMMAND_PROTOCOL_H_
