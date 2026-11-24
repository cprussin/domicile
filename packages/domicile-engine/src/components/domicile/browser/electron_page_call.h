// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_ELECTRON_PAGE_CALL_H_
#define COMPONENTS_DOMICILE_BROWSER_ELECTRON_PAGE_CALL_H_

#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "base/types/expected.h"
#include "base/values.h"

class GURL;

namespace domicile {

// A webContents member the engine carries out on an Electron window's page,
// which the app numbers: `page_call`, answered with `page_result` under the
// same number. See "Page calls" in docs/architecture/ELECTRON-APPS.md.
//
//   {"type":"page_call","window":1,"call":4,"method":"insert_css",
//    "css":"a{}","user":false}
//   -> {"type":"page_result","window":1,"call":4,"result":"<key>"}
//   -> {"type":"page_result","window":1,"call":4,"error":"..."}
//
// The methods, with what each takes and gives (null when nothing):
//
//   reload_ignoring_cache                  (webContents.reloadIgnoringCache)
//   insert_css {css, user} -> key          (webContents.insertCSS, in the
//                                           main frame's document: the
//                                           user's sheet when `user`)
//   remove_inserted_css {key, user}        (webContents.removeInsertedCSS)
//   execute_in_isolated_world {world, scripts:[{code, url?}],
//                              user_gesture} -> what the last gave
//                                          (world 0 is the page's own, 999
//                                           the preload's, as in Electron)
//   copy_image_at {x, y}                   (in CSS pixels from the page's
//   copy_video_frame_at {x, y}              top left)
//   adjust_selection {start, end}          (moves the selection's ends by
//                                           characters)
//   set_caret_browsing {enabled}
//   set_webrtc_ip_policy {policy}          (Electron's names: default,
//                                           default_public_interface_only,
//                                           default_public_and_private_
//                                           interfaces,
//                                           disable_non_proxied_udp)
//   set_ignore_input {ignore}              (win.setEnabled(false), and a
//                                           modal's parent)
//   save_video_frame_at {x, y}             (webContents.saveVideoFrameAs:
//                                           the frame goes to the app's
//                                           will-download, as a download)
//   set_image_animation_policy {policy}    (animate, animate_once,
//                                           no_animation)
//   set_webrtc_udp_port_range {min, max}   (both 0 for any port)
//   crash_renderer                         (forcefullyCrashRenderer)
//   printers -> [{name, display_name, description, options}]
//                                          (getPrintersAsync: the system's
//                                           printers, as CUPS lists them)
//   devtools {devtools_method, params, debugger?, session_id?}
//            -> its result                 (a DevTools Protocol method, on
//                                           one of the page's two clients:
//                                           the host members' own, which
//                                           attaches at its first method and
//                                           stays while the page lives, or
//                                           with `debugger`,
//                                           webContents.debugger's, while it
//                                           is attached; `session_id` sends
//                                           it to a target the client
//                                           attached to)
//   debugger_attach, debugger_detach       (webContents.debugger's client)
//
// A client's events come as
//   {"type":"devtools_event","window":1,"method":"...","params":{...},
//    "debugger":true,"session_id":"..."}
// with `debugger` for the debugger's client and `session_id` for an attached
// target's. The debugger's client going with its page, or with a navigation
// it may not follow, is
//   {"type":"debugger_detached","window":1,"reason":"target closed"}
//
// Neither client is trusted, reads or writes local files, or follows the
// page to a URL ElectronDevToolsMayAttachTo refuses, so a method takes the
// page nowhere the app's loadURL couldn't.

struct ElectronReloadIgnoringCache {
  friend bool operator==(const ElectronReloadIgnoringCache&,
                         const ElectronReloadIgnoringCache&) = default;
};

struct ElectronInsertCss {
  std::string css;
  bool user = false;
  friend bool operator==(const ElectronInsertCss&,
                         const ElectronInsertCss&) = default;
};

struct ElectronRemoveInsertedCss {
  std::string key;
  bool user = false;
  friend bool operator==(const ElectronRemoveInsertedCss&,
                         const ElectronRemoveInsertedCss&) = default;
};

// One of executeJavaScriptInIsolatedWorld's scripts.
struct ElectronScript {
  std::string code;
  // Where the page's console says it came from; empty for nowhere.
  std::string url;
  friend bool operator==(const ElectronScript&,
                         const ElectronScript&) = default;
};

// Electron's world ids: 0 the page's own world, 999 the preload's, any other
// from 1 a world of the app's.
inline constexpr int kElectronMainWorld = 0;
inline constexpr int kElectronPreloadWorld = 999;
// The most worlds of its own an app numbers: Blink's are counted below
// kEmbedderWorldIdLimit, so the app's are counted in a range of their own.
inline constexpr int kElectronMostWorlds = 1 << 20;

struct ElectronExecuteInIsolatedWorld {
  int world = kElectronMainWorld;
  std::vector<ElectronScript> scripts;
  bool user_gesture = false;
  friend bool operator==(const ElectronExecuteInIsolatedWorld&,
                         const ElectronExecuteInIsolatedWorld&) = default;
};

struct ElectronCopyImageAt {
  int x = 0;
  int y = 0;
  friend bool operator==(const ElectronCopyImageAt&,
                         const ElectronCopyImageAt&) = default;
};

struct ElectronCopyVideoFrameAt {
  int x = 0;
  int y = 0;
  friend bool operator==(const ElectronCopyVideoFrameAt&,
                         const ElectronCopyVideoFrameAt&) = default;
};

struct ElectronAdjustSelection {
  int start = 0;
  int end = 0;
  friend bool operator==(const ElectronAdjustSelection&,
                         const ElectronAdjustSelection&) = default;
};

struct ElectronSetCaretBrowsing {
  bool enabled = false;
  friend bool operator==(const ElectronSetCaretBrowsing&,
                         const ElectronSetCaretBrowsing&) = default;
};

// setWebRTCIPHandlingPolicy's policies, by Electron's names.
enum class ElectronWebRtcIpPolicy {
  kDefault,
  kDefaultPublicInterfaceOnly,
  kDefaultPublicAndPrivateInterfaces,
  kDisableNonProxiedUdp,
};

struct ElectronSetWebRtcIpPolicy {
  ElectronWebRtcIpPolicy policy = ElectronWebRtcIpPolicy::kDefault;
  friend bool operator==(const ElectronSetWebRtcIpPolicy&,
                         const ElectronSetWebRtcIpPolicy&) = default;
};

struct ElectronSetIgnoreInput {
  bool ignore = false;
  friend bool operator==(const ElectronSetIgnoreInput&,
                         const ElectronSetIgnoreInput&) = default;
};

struct ElectronSaveVideoFrameAt {
  int x = 0;
  int y = 0;
  friend bool operator==(const ElectronSaveVideoFrameAt&,
                         const ElectronSaveVideoFrameAt&) = default;
};

// setImageAnimationPolicy's policies.
enum class ElectronImageAnimationPolicy {
  kAnimate,
  kAnimateOnce,
  kNoAnimation,
};

struct ElectronSetImageAnimationPolicy {
  ElectronImageAnimationPolicy policy = ElectronImageAnimationPolicy::kAnimate;
  friend bool operator==(const ElectronSetImageAnimationPolicy&,
                         const ElectronSetImageAnimationPolicy&) = default;
};

// setWebRTCUDPPortRange: the ports WebRTC may use, from `min` to `max`, or
// any when both are 0.
struct ElectronSetWebRtcUdpPortRange {
  int min = 0;
  int max = 0;
  friend bool operator==(const ElectronSetWebRtcUdpPortRange&,
                         const ElectronSetWebRtcUdpPortRange&) = default;
};

struct ElectronCrashRenderer {
  friend bool operator==(const ElectronCrashRenderer&,
                         const ElectronCrashRenderer&) = default;
};

struct ElectronGetPrinters {
  friend bool operator==(const ElectronGetPrinters&,
                         const ElectronGetPrinters&) = default;
};

// A DevTools Protocol method for one of the page's clients.
struct ElectronDevToolsMethod {
  std::string method;
  base::DictValue params;
  // For webContents.debugger's client, not the host members'.
  bool debugger = false;
  // The session of a target the client attached to; empty for the page.
  std::string session_id;
  friend bool operator==(const ElectronDevToolsMethod&,
                         const ElectronDevToolsMethod&) = default;
};

struct ElectronAttachDebugger {
  friend bool operator==(const ElectronAttachDebugger&,
                         const ElectronAttachDebugger&) = default;
};

struct ElectronDetachDebugger {
  friend bool operator==(const ElectronDetachDebugger&,
                         const ElectronDetachDebugger&) = default;
};

using ElectronPageMethod = std::variant<ElectronReloadIgnoringCache,
                                        ElectronInsertCss,
                                        ElectronRemoveInsertedCss,
                                        ElectronExecuteInIsolatedWorld,
                                        ElectronCopyImageAt,
                                        ElectronCopyVideoFrameAt,
                                        ElectronAdjustSelection,
                                        ElectronSetCaretBrowsing,
                                        ElectronSetWebRtcIpPolicy,
                                        ElectronSetIgnoreInput,
                                        ElectronDevToolsMethod,
                                        ElectronSaveVideoFrameAt,
                                        ElectronSetImageAnimationPolicy,
                                        ElectronSetWebRtcUdpPortRange,
                                        ElectronCrashRenderer,
                                        ElectronGetPrinters,
                                        ElectronAttachDebugger,
                                        ElectronDetachDebugger>;

// Call `call` on window `window`'s page.
struct ElectronPageCall {
  int window = 0;
  int call = 0;
  ElectronPageMethod method;
  friend bool operator==(const ElectronPageCall&,
                         const ElectronPageCall&) = default;
};

// Page method `name` with what it takes from `request`, or why it is none.
base::expected<ElectronPageMethod, std::string> ElectronPageMethodIn(
    std::string_view name,
    base::DictValue& request);

// The answer to window `window`'s page call `call`: what it gave (null for
// nothing), or why it gave nothing.
std::string ElectronPageResult(
    int window,
    int call,
    const base::expected<base::Value, std::string>& result);

// An event of one of a page's DevTools clients.
struct ElectronDevToolsMessage {
  std::string method;
  base::DictValue params;
  // From webContents.debugger's client, not the host members'.
  bool debugger = false;
  // From a target the client attached to; empty for the page.
  std::string session_id;
};

// Event `event` of window `window`'s page's DevTools client.
std::string ElectronDevToolsEvent(int window, ElectronDevToolsMessage event);

// Window `window`'s debugger detached from its page, for `reason`.
std::string ElectronDebuggerDetached(int window, std::string_view reason);

// Whether a page's DevTools client may stay on, or take the page to, `url`:
// not a WebUI's (`is_webui`), Chrome's own pages or the shell's, which an
// Electron page never shows.
bool ElectronDevToolsMayAttachTo(const GURL& url, bool is_webui);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_ELECTRON_PAGE_CALL_H_
