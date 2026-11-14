// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_ELECTRON_PROTOCOL_H_
#define COMPONENTS_DOMICILE_BROWSER_ELECTRON_PROTOCOL_H_

#include <optional>
#include <string>
#include <string_view>
#include <variant>

#include "base/types/expected.h"
#include "base/values.h"
#include "components/domicile/browser/web_view_partition.h"
#include "url/gurl.h"

namespace domicile {

// The Electron socket's protocol: `electron-host` runs an Electron app's main
// process and asks the engine for its windows. A connection is one app. Each
// line is one JSON object, in both directions.
//
//   {"type":"hello","version":1,"app_id":"com.anthropic.Claude",
//    "partition":"persist:electron-claude"}
//   -> {"type":"ready"}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"open_window","window":1,"url":"https://claude.ai/",
//    "preload":"...the preload's source..."}       ("preload" may be left out)
//   -> {"type":"window_opened","window":1}
//   -> {"type":"window_refused","window":1,"why":"..."}
//
//   {"type":"load_url","window":1,"url":"https://claude.ai/new"}
//   {"type":"focus_window","window":1}
//   {"type":"close_window","window":1}     (the page may refuse)
//   {"type":"destroy_window","window":1}   (closes without asking)
//   {"type":"ipc_send","window":1,"channel":"c","args":[...]}
//                                          (webContents.send)
//   {"type":"ipc_reply","invoke":3,"result":...}    (a handler's result)
//   {"type":"ipc_reply","invoke":3,"error":"..."}   (or why it failed)
//
// The engine also says, on its own:
//
//   {"type":"window_loaded","window":1}
//   {"type":"title_changed","window":1,"title":"Claude"}
//   {"type":"window_closed","window":1}
//   {"type":"ipc_message","window":1,"channel":"c","args":[...]}
//                                          (ipcRenderer.send)
//   {"type":"ipc_invoke","window":1,"invoke":3,"channel":"c","args":[...]}
//                                          (ipcRenderer.invoke; answer
//                                           with ipc_reply)
//
// The host picks window numbers. Only http and https URLs open: content
// loads no other scheme in a guest. An app's own files and protocols arrive
// with the protocol handlers.
//
// IPC arguments and results are JSON, not structured clones: a Map, a Set or
// bytes do not survive the trip. An invoke's number is the engine's, counted
// per app.

inline constexpr int kElectronProtocolVersion = 1;

// A window's number, from 1. The host counts them up from 1, so an int lasts.
using ElectronWindow = int;

struct ElectronHello {
  // The app's desktop id, never empty.
  std::string app_id;
  // Where the app's pages keep their data. Never the profile's own.
  WebViewPartition partition;
};

struct ElectronOpenWindow {
  ElectronWindow window;
  GURL url;
  // The preload's source; empty for none.
  std::string preload;
};

struct ElectronLoadUrl {
  ElectronWindow window;
  GURL url;
};

struct ElectronFocusWindow {
  ElectronWindow window;
};

struct ElectronCloseWindow {
  ElectronWindow window;
};

struct ElectronDestroyWindow {
  ElectronWindow window;
};

// webContents.send: `args` on `channel` to window `window`'s page.
struct ElectronSendToPage {
  ElectronWindow window;
  std::string channel;
  base::ListValue args;
};

// An ipcMain handler's answer to invoke `invoke`: its result, or why it
// failed.
struct ElectronReply {
  int invoke;
  base::expected<base::Value, std::string> answer;
};

using ElectronRequest = std::variant<ElectronHello,
                                     ElectronOpenWindow,
                                     ElectronLoadUrl,
                                     ElectronFocusWindow,
                                     ElectronCloseWindow,
                                     ElectronDestroyWindow,
                                     ElectronSendToPage,
                                     ElectronReply>;

// Why a line is not a request, and which window it was for when it names
// one, so the app hears of it as that window's.
struct ElectronRefusal {
  std::string why;
  std::optional<ElectronWindow> window;

  friend bool operator==(const ElectronRefusal&,
                         const ElectronRefusal&) = default;
};

// The request on `line`, or why it is not one.
base::expected<ElectronRequest, ElectronRefusal> ParseElectronRequest(
    std::string_view line);

// The lines the engine sends, each ending in a newline.
std::string ElectronReady();
std::string ElectronRefused(std::string_view why);
std::string ElectronWindowOpened(ElectronWindow window);
std::string ElectronWindowRefused(ElectronWindow window, std::string_view why);
std::string ElectronWindowLoaded(ElectronWindow window);
std::string ElectronTitleChanged(ElectronWindow window, std::string_view title);
std::string ElectronWindowClosed(ElectronWindow window);
std::string ElectronIpcMessage(ElectronWindow window,
                               std::string_view channel,
                               const base::ListValue& args);
std::string ElectronIpcInvoke(ElectronWindow window,
                              int invoke,
                              std::string_view channel,
                              const base::ListValue& args);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_ELECTRON_PROTOCOL_H_
