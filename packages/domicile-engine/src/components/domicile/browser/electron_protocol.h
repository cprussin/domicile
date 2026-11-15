// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_ELECTRON_PROTOCOL_H_
#define COMPONENTS_DOMICILE_BROWSER_ELECTRON_PROTOCOL_H_

#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

#include "base/files/file_path.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "components/domicile/browser/web_view_partition.h"
#include "components/domicile/common/electron_schemes.h"
#include "url/gurl.h"

namespace domicile {

// The Electron socket's protocol: `electron-host` runs an Electron app's main
// process and asks the engine for its windows. A connection is one app. Each
// line is one JSON object, in both directions.
//
//   {"type":"hello","version":1,"app_id":"com.anthropic.Claude",
//    "partition":"persist:electron-claude"}
//   -> {"type":"ready","schemes":[{"scheme":"app",
//                                  "privileges":["standard","secure"]}]}
//        (the apps' own schemes the engine registered as it started; see
//        components/domicile/common/electron_schemes.h)
//   -> {"type":"refused","why":"..."}
//
//   {"type":"open_window","window":1,"url":"https://claude.ai/",
//    "preload":"...the preload's source...",       ("preload" may be left out)
//    "session":"persist:cowork"}           (Electron's partition; left out
//                                           or "" is the app's own session)
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
//   {"type":"ipc_post","window":1,"channel":"c","message":...,
//    "ports":["m1"]}                       (webContents.postMessage)
//   {"type":"port_post","window":1,"port":"r1","data":...}
//                                          (a port's postMessage)
//   {"type":"port_close","window":1,"port":"m1"}
//   {"type":"handle_protocol","session":"","scheme":"app"}
//   {"type":"unhandle_protocol","session":"","scheme":"app"}
//                                          (protocol.handle and unhandle)
//   {"type":"protocol_response","request":5,"status":200,
//    "headers":[["content-type","text/html"]],
//    "body":"<base64>"}                    (the whole body)
//   {"type":"protocol_response","request":5,"status":200,"headers":[],
//    "file":"/abs/path"}                   (a file the engine reads)
//   {"type":"protocol_response","request":5,"status":200,"headers":[],
//    "stream":true}                        (the body follows in pieces:)
//   {"type":"protocol_data","request":5,"data":"<base64>"}
//   {"type":"protocol_end","request":5}    (or with "error":"...")
//   {"type":"protocol_response","request":5,"error":"..."}
//                                          (the handler failed)
//   {"type":"web_request_listen","session":"",
//    "events":["before_request","completed"]}
//                                          (the session's webRequest
//                                           listeners, all of them)
//   {"type":"web_request_answer","ask":9,"cancel":true}
//   {"type":"web_request_answer","ask":9,"redirect_url":"https://..."}
//   {"type":"web_request_answer","ask":10,"request_headers":[["a","1"]]}
//   {"type":"web_request_answer","ask":11,"response_headers":[["b","2"]],
//    "status_line":"HTTP/1.1 200 OK"}      (a listener's answer; {} with
//                                           only "ask" changes nothing)
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
//   {"type":"ipc_send_sync","window":1,"invoke":4,"channel":"c","args":[...]}
//                                          (ipcRenderer.sendSync; answer
//                                           with ipc_reply, as the page
//                                           waits until then)
//   {"type":"ipc_post","window":1,"channel":"c","message":...,
//    "ports":["r1"]}                       (ipcRenderer.postMessage)
//   {"type":"port_message","window":1,"port":"m1","data":...}
//   {"type":"port_closed","window":1,"port":"m1"}
//   {"type":"page_gone","window":1}        (a new document replaced the
//                                           page: its ports and listeners
//                                           are gone)
//   {"type":"protocol_request","request":5,"session":"",
//    "url":"app://localhost/","method":"GET","headers":[["accept","*/*"]],
//    "body":"<base64>"}                    (a page's request for a scheme
//                                           its session handles; answer
//                                           with protocol_response. "body"
//                                           only when it has one)
//   {"type":"web_request","event":"before_request","ask":9,"id":4,
//    "session":"","window":1,"url":"https://claude.ai/","method":"GET",
//    "resource_type":"mainFrame","referrer":""}
//                                          (an event of a request in a
//                                           session with listeners for it.
//                                           "ask" when the request waits
//                                           for web_request_answer:
//                                           before_request,
//                                           before_send_headers and
//                                           headers_received. "window" when
//                                           a window's page made it. The
//                                           others: send_headers,
//                                           response_started,
//                                           before_redirect, completed and
//                                           error_occurred, with headers,
//                                           status_code, status_line,
//                                           redirect_url, error, from_cache
//                                           and ip as each knows them)
//
// The host picks window numbers. A window opens http and https URLs, and
// file: and the app's own schemes once its session handles them: the app
// serves those, file: included, as Electron's protocol.handle does. An
// http or https request goes to the network unless the session handles
// that scheme too.
//
// Sessions are Electron's partitions inside the app's own: "persist:x" is
// kept on disk, as in Electron, and no session reaches another app's or the
// profile's storage.
//
// Protocol bodies are base64, and headers are [name, value] pairs, so a
// name may repeat. A request's number is the engine's, counted per app.
//
// IPC arguments and results are JSON, not structured clones: a Map, a Set or
// bytes do not survive the trip. An invoke's number is the engine's, counted
// per app.
//
// Message ports: each end the main process keeps is one side of a pipe whose
// other side is a MessagePort in the window's page. A port's name says who
// made it: "m" and a number for the main process, "r" and a number for the
// page. The page counts its own from 1 again in each document, which is why
// page_gone says when the last one's went. Messages on ports are JSON too.

// Whether `name` names a message port: "m" or "r", then a number.
bool IsElectronPortName(std::string_view name);

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
  // Its Electron partition; empty for the app's own session.
  std::string session;
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

// webContents.postMessage: `message` and the main process's ends of `ports`
// to window `window`'s page, on `channel`.
struct ElectronPostToPage {
  ElectronWindow window;
  std::string channel;
  base::Value message;
  std::vector<std::string> ports;
};

// `data` on port `port`, whose other end is window `window`'s page's.
struct ElectronPortPost {
  ElectronWindow window;
  std::string port;
  base::Value data;
};

// The main process closed port `port`.
struct ElectronPortClose {
  ElectronWindow window;
  std::string port;
};

// Headers as [name, value] pairs, in order.
using ElectronHeaders = std::vector<std::pair<std::string, std::string>>;

// protocol.handle, or unhandle when `handle` is false: session `session`'s
// pages' requests for `scheme` go to the app.
struct ElectronHandleProtocol {
  std::string session;
  std::string scheme;
  bool handle = true;
};

// A response whose body follows in protocol_data lines.
struct ElectronStreamedBody {
  friend bool operator==(const ElectronStreamedBody&,
                         const ElectronStreamedBody&) = default;
};

// A response's body: all of it, a file the engine reads, or pieces to come.
using ElectronResponseBody =
    std::variant<std::string, base::FilePath, ElectronStreamedBody>;

struct ElectronResponse {
  int status = 200;
  ElectronHeaders headers;
  ElectronResponseBody body;
};

// A protocol handler's answer to request `request`, or why it failed.
struct ElectronProtocolResponse {
  int request;
  base::expected<ElectronResponse, std::string> response;
};

// A piece of a streamed response's body.
struct ElectronProtocolData {
  int request;
  std::string bytes;
};

// A streamed response's end: complete, or why it broke off.
struct ElectronProtocolEnd {
  int request;
  std::optional<std::string> error;
};

// A page's request that its session's handler answers.
struct ElectronFetch {
  GURL url;
  std::string method;
  ElectronHeaders headers;
  // Its body, when it has one.
  std::optional<std::string> body;
};

// An ipcMain handler's answer to invoke `invoke`: its result, or why it
// failed.
struct ElectronReply {
  int invoke;
  base::expected<base::Value, std::string> answer;
};

// session.webRequest's events, in the order a request meets them.
enum class ElectronWebRequestEvent {
  kBeforeRequest,
  kBeforeSendHeaders,
  kSendHeaders,
  kHeadersReceived,
  kResponseStarted,
  kBeforeRedirect,
  kCompleted,
  kErrorOccurred,
};

// `event`'s name on the wire: "before_request", "headers_received"...
std::string_view ElectronWebRequestEventName(ElectronWebRequestEvent event);

// Whether a request waits for the app's answer to `event`: onBeforeRequest,
// onBeforeSendHeaders and onHeadersReceived. The rest only tell the app.
bool IsBlockingElectronWebRequestEvent(ElectronWebRequestEvent event);

// Session `session` has webRequest listeners for `events` and no others.
struct ElectronWebRequestListen {
  std::string session;
  std::set<ElectronWebRequestEvent> events;

  friend bool operator==(const ElectronWebRequestListen&,
                         const ElectronWebRequestListen&) = default;
};

// A listener's answer to a waiting event, ask `ask`. Empty, it changes
// nothing; which fields an event may carry is ElectronApp's to check.
struct ElectronWebRequestAnswer {
  int ask = 0;
  bool cancel = false;
  // onBeforeRequest's redirectURL.
  std::optional<GURL> redirect_url;
  // onBeforeSendHeaders's requestHeaders: all of them, replacing the
  // request's.
  std::optional<ElectronHeaders> request_headers;
  // onHeadersReceived's responseHeaders and statusLine, replacing the
  // response's.
  std::optional<ElectronHeaders> response_headers;
  std::optional<std::string> status_line;

  friend bool operator==(const ElectronWebRequestAnswer&,
                         const ElectronWebRequestAnswer&) = default;
};

// A request as session.webRequest's listeners see it. What an event does not
// know yet is left out.
struct ElectronWebRequestDetails {
  // The same for each of one request's events, redirects included.
  int id = 0;
  GURL url;
  std::string method;
  // Electron's resourceType: "mainFrame", "subFrame", "script", "xhr"...
  std::string resource_type;
  std::string referrer;
  std::optional<ElectronHeaders> request_headers;
  std::optional<ElectronHeaders> response_headers;
  std::optional<int> status_code;
  std::optional<std::string> status_line;
  // onBeforeRedirect's redirectURL.
  std::optional<GURL> redirect_url;
  // onErrorOccurred's error, as Electron names it: "net::ERR_ABORTED".
  std::optional<std::string> error;
  bool from_cache = false;
  std::optional<std::string> ip;
};

// A cookie as Electron's session.cookies shows it.
struct ElectronCookie {
  std::string name;
  std::string value;
  std::string domain;
  bool host_only = false;
  std::string path;
  bool secure = false;
  bool http_only = false;
  // Seconds since the epoch; none for a session cookie.
  std::optional<double> expiration_date;
  // "unspecified", "no_restriction", "lax" or "strict".
  std::string same_site = "unspecified";

  friend bool operator==(const ElectronCookie&,
                         const ElectronCookie&) = default;
};

// cookies.get's filter. What it leaves out matches any cookie.
struct ElectronCookieFilter {
  // The cookies a request to `url` would send.
  std::optional<GURL> url;
  std::optional<std::string> name;
  // This domain or one inside it.
  std::optional<std::string> domain;
  std::optional<std::string> path;
  std::optional<bool> secure;
  std::optional<bool> session;
  std::optional<bool> http_only;

  friend bool operator==(const ElectronCookieFilter&,
                         const ElectronCookieFilter&) = default;
};

// Whether `cookie` passes `filter`, but for its url, which picks the
// cookies to look through.
bool ElectronCookieMatches(const ElectronCookie& cookie,
                           const ElectronCookieFilter& filter);

// cookies.set's details.
struct ElectronCookieDetails {
  GURL url;
  std::string name;
  std::string value;
  std::optional<std::string> domain;
  std::optional<std::string> path;
  bool secure = false;
  bool http_only = false;
  std::optional<double> expiration_date;
  std::string same_site = "lax";

  friend bool operator==(const ElectronCookieDetails&,
                         const ElectronCookieDetails&) = default;
};

struct ElectronGetCookies {
  ElectronCookieFilter filter;
  friend bool operator==(const ElectronGetCookies&,
                         const ElectronGetCookies&) = default;
};
struct ElectronSetCookie {
  ElectronCookieDetails details;
  friend bool operator==(const ElectronSetCookie&,
                         const ElectronSetCookie&) = default;
};
// cookies.remove: cookie `name` that a request to `url` would send.
struct ElectronRemoveCookie {
  GURL url;
  std::string name;
  friend bool operator==(const ElectronRemoveCookie&,
                         const ElectronRemoveCookie&) = default;
};
// cookies.flushStore.
struct ElectronFlushCookies {
  friend bool operator==(const ElectronFlushCookies&,
                         const ElectronFlushCookies&) = default;
};
// session.clearStorageData: `storages` (Electron's names; none is all) of
// `origin` (none is every origin).
struct ElectronClearStorage {
  std::optional<GURL> origin;
  std::set<std::string> storages;
  friend bool operator==(const ElectronClearStorage&,
                         const ElectronClearStorage&) = default;
};
// session.clearCache.
struct ElectronClearCache {
  friend bool operator==(const ElectronClearCache&,
                         const ElectronClearCache&) = default;
};
// session.setUserAgent, for the session's pages from now on.
struct ElectronSetUserAgent {
  std::string user_agent;
  friend bool operator==(const ElectronSetUserAgent&,
                         const ElectronSetUserAgent&) = default;
};

using ElectronSessionMethod = std::variant<ElectronGetCookies,
                                           ElectronSetCookie,
                                           ElectronRemoveCookie,
                                           ElectronFlushCookies,
                                           ElectronClearStorage,
                                           ElectronClearCache,
                                           ElectronSetUserAgent>;

// A call on session `session`, which the engine answers with
// ElectronSessionResult under `call`.
struct ElectronSessionCall {
  int call = 0;
  std::string session;
  ElectronSessionMethod method;

  friend bool operator==(const ElectronSessionCall&,
                         const ElectronSessionCall&) = default;
};

// The storages session.clearStorageData knows, by Electron's names.
bool IsElectronStorage(std::string_view storage);

using ElectronRequest = std::variant<ElectronHello,
                                     ElectronOpenWindow,
                                     ElectronLoadUrl,
                                     ElectronFocusWindow,
                                     ElectronCloseWindow,
                                     ElectronDestroyWindow,
                                     ElectronSendToPage,
                                     ElectronPostToPage,
                                     ElectronPortPost,
                                     ElectronPortClose,
                                     ElectronReply,
                                     ElectronHandleProtocol,
                                     ElectronProtocolResponse,
                                     ElectronProtocolData,
                                     ElectronProtocolEnd,
                                     ElectronWebRequestListen,
                                     ElectronWebRequestAnswer,
                                     ElectronSessionCall>;

// Why a line is not a request, and which window or protocol request it was
// for when it names one, so the app hears of it as that window's and the
// page's request fails with it.
struct ElectronRefusal {
  std::string why;
  std::optional<ElectronWindow> window;
  std::optional<int> request;
  // The session call it was, which the app hears failed.
  std::optional<int> call;

  friend bool operator==(const ElectronRefusal&,
                         const ElectronRefusal&) = default;
};

// The partition of session `session` of an app whose own is `app`: the app's
// for "", otherwise one inside it, kept on disk for "persist:" as Electron
// does. Or why `session` names none.
base::expected<WebViewPartition, std::string> ElectronSessionPartition(
    const WebViewPartition& app,
    std::string_view session);

// The request on `line`, or why it is not one.
base::expected<ElectronRequest, ElectronRefusal> ParseElectronRequest(
    std::string_view line);

// The lines the engine sends, each ending in a newline.
// `schemes` are the apps' own schemes the engine registered as it started.
std::string ElectronReady(const std::vector<ElectronScheme>& schemes);
// The answer to session call `call`: its result (null when it has none), or
// why it failed.
std::string ElectronSessionResult(
    int call,
    const base::expected<base::Value, std::string>& result);
// `cookie` as cookies.get gives it.
base::DictValue ElectronCookieValue(const ElectronCookie& cookie);

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
std::string ElectronIpcSendSync(ElectronWindow window,
                                int invoke,
                                std::string_view channel,
                                const base::ListValue& args);
std::string ElectronIpcPost(ElectronWindow window,
                            std::string_view channel,
                            const base::Value& message,
                            const std::vector<std::string>& ports);
std::string ElectronPortMessage(ElectronWindow window,
                                std::string_view port,
                                const base::Value& data);
std::string ElectronPortClosed(ElectronWindow window, std::string_view port);
std::string ElectronPageGone(ElectronWindow window);
// Event `event` of a request in session `session`, made by window
// `window`'s page when it was one. `ask` is set when the request waits for
// web_request_answer.
std::string ElectronWebRequest(ElectronWebRequestEvent event,
                               std::optional<int> ask,
                               std::optional<ElectronWindow> window,
                               std::string_view session,
                               const ElectronWebRequestDetails& details);
std::string ElectronProtocolRequest(int request,
                                    std::string_view session,
                                    const ElectronFetch& fetch);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_ELECTRON_PROTOCOL_H_
