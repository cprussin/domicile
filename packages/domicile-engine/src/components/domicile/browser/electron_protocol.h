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
//    "partition":"persist:electron-claude",
//    "electron_version":"45.2.1",          (process.versions.electron in its
//    "resources_path":"/abs"}               pages, and process.resourcesPath)
//   -> {"type":"ready","schemes":[{"scheme":"app",
//                                  "privileges":["standard","secure"]}],
//       "user_agent":"Mozilla/5.0 ... Chrome/160.0.0.0 Safari/537.36",
//       "chrome_version":"160.0.8155.0"}
//        (the apps' own schemes the engine registered as it started; see
//        components/domicile/common/electron_schemes.h. The engine's own
//        user agent and Chrome version, which Electron's user agent is
//        made from.)
//   -> {"type":"refused","why":"..."}
//
//   {"type":"open_window","window":1,"url":"https://claude.ai/",
//    "preload":"...the preload's source...",       ("preload" may be left out)
//    "session":"persist:cowork",           (Electron's partition; left out
//                                           or "" is the app's own session)
//    "title":"Claude",                     (the window's own title, which
//                                           the desktop shows over its
//                                           page's; left out for none)
//    "hidden":true,                        (show: false; left out is shown)
//    "arguments":["--a=1"],                (additionalArguments, in the
//                                           page's process.argv; left out
//                                           for none)
//    "node":{"preload":"/abs/preload.js",  (a window that isn't sandboxed:
//            "integration":false,           Node.js in its page; see
//            "context_isolation":true,      ElectronNode. Left out, the
//            "app_path":"/abs/app",         page is sandboxed. With it the
//            "env":{"HOME":"/home/a"}}}     preload is a file, so the
//                                           top-level "preload" is left
//                                           out)
//   -> {"type":"window_opened","window":1}
//   -> {"type":"window_refused","window":1,"why":"..."}
//
//   {"type":"load_url","window":1,"url":"https://claude.ai/new"}
//   {"type":"focus_window","window":1}
//   {"type":"go_to_index","window":1,"index":0}
//                                          (navigationHistory.goToIndex,
//                                           and goBack and goForward: an
//                                           index page_state listed)
//   {"type":"clear_history","window":1}    (navigationHistory.clear: all
//                                           but the page shown)
//   {"type":"edit","window":1,"command":"undo"}
//                                          (webContents.undo and the rest
//                                           of the Edit menu: undo, redo,
//                                           cut, copy, paste,
//                                           paste_and_match_style, delete,
//                                           select_all, unselect,
//                                           center_selection)
//   {"type":"replace","window":1,"text":"word","misspelling":false}
//                                          (webContents.replace, or
//                                           replaceMisspelling)
//   {"type":"find_in_page","window":1,"request":1,"text":"a",
//    "forward":true,"find_next":false,"match_case":false}
//                                          (webContents.findInPage, which
//                                           the app numbers from 1)
//   {"type":"stop_find_in_page","window":1,"action":"clear_selection"}
//                                          (webContents.stopFindInPage:
//                                           clear_selection,
//                                           keep_selection or
//                                           activate_selection)
//   {"type":"set_title","window":1,"title":"Claude"}
//                                          (win.setTitle, and a page title
//                                           the app let through)
//   {"type":"set_user_agent_fallback","user_agent":"..."}
//                                          (app.userAgentFallback: the user
//                                           agent of each session without
//                                           its own)
//   {"type":"set_hidden","window":1,"hidden":true}
//                                          (win.hide, and win.show with
//                                           false)
//   {"type":"popup_menu","window":1,"popup":1,"menu":[...],"x":10,"y":20}
//                                          (Menu.popup: a menu the shell
//                                           draws over the window's page,
//                                           at x and y in its CSS pixels,
//                                           or where the user last pressed
//                                           in it without them)
//   {"type":"close_popup_menu","window":1,"popup":1}
//                                          (Menu.closePopup)
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
//   {"type":"window_dom_ready","window":1}  (its main frame's
//                                           DOMContentLoaded)
//   {"type":"window_loaded","window":1}
//   {"type":"title_changed","window":1,"title":"Claude"}
//   {"type":"window_closed","window":1}
//   {"type":"close_asked","window":1}      (the user asked to close the
//                                           window: the app decides, as a
//                                           BrowserWindow's `close` event)
//   {"type":"page_state","window":1,
//    "entries":[{"url":"https://a/","title":"A"}],
//    "index":0,"loading":false,"focused":true,"pid":1234,"crashed":false}
//                                          (the page's history and which
//                                           entry it shows, whether it is
//                                           loading, has the keyboard
//                                           focus, its renderer's pid and
//                                           whether that renderer is gone:
//                                           each time one changes)
//   {"type":"found_in_page","window":1,"request":1,"matches":3,
//    "active_match_ordinal":1,
//    "selection":{"x":0,"y":0,"width":10,"height":10}}
//                                          (find_in_page's last answer, as
//                                           Electron's found-in-page)
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
// A page's new window (window.open, a target="_blank" link, a middle click)
// asks the app first, as setWindowOpenHandler does:
//
//   -> {"type":"window_open","ask":7,"window":1,"url":"https://a.test/",
//       "frame_name":"","features":"width=500,height=600",
//       "disposition":"foreground-tab","referrer":"https://claude.ai/"}
//   {"type":"window_open_answer","ask":7,"action":"deny"}
//                                          (no window opens)
//   {"type":"window_open_answer","ask":7,"action":"allow","window":2,
//    "title":"Sign in"}                    (window 2 opens where the page
//                                           asked, with open_window's other
//                                           keys; then window_opened or
//                                           window_refused, as for
//                                           open_window)
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

// What the engine tells each app of itself as it says ready.
struct ElectronEngineInfo {
  // The engine's own user agent, its pages' by default.
  std::string user_agent;
  // Chrome's full version, which Electron's user agent names.
  std::string chrome_version;
};

struct ElectronHello {
  // The app's desktop id, never empty.
  std::string app_id;
  // Where the app's pages keep their data. Never the profile's own.
  WebViewPartition partition;
  // process.versions.electron in its pages: the Electron the app is told it
  // runs on. Never empty.
  std::string electron_version;
  // process.resourcesPath in its pages, absolute.
  std::string resources_path;
};

// Node.js in a window's page, as Electron gives a window that isn't
// sandboxed: its preload loads through Node's require, in its own world, or
// in the page's without context isolation, where with nodeIntegration the
// page keeps Node's globals. See "Phase 2" in
// docs/architecture/ELECTRON-APPS.md.
struct ElectronNode {
  // The preload's file; empty for none.
  std::string preload;
  // nodeIntegration: Node's require and globals in the page's own world.
  // Electron gives them only without context isolation.
  bool integration = false;
  // contextIsolation: the preload runs in a world of its own, not the
  // page's.
  bool context_isolation = true;
  // The app's directory, which a page that isn't a file searches for
  // modules from.
  std::string app_path;
  // The main process's environment, which an Electron page's process.env
  // is.
  std::vector<std::pair<std::string, std::string>> env;

  friend bool operator==(const ElectronNode&, const ElectronNode&) = default;
};

struct ElectronOpenWindow {
  ElectronWindow window;
  GURL url;
  // The preload's source, for a sandboxed page; empty for none.
  std::string preload;
  // Node.js in the page, for a window that isn't sandboxed; none when it is.
  std::optional<ElectronNode> node;
  // webPreferences.additionalArguments: what Electron adds to the page's
  // renderer's command line, which its preload reads from process.argv.
  std::vector<std::string> arguments;
  // Its Electron partition; empty for the app's own session.
  std::string session;
  // A WebContentsView's page rather than a BrowserWindow: listed to the shell
  // only while a window holds it (ElectronSetViews).
  bool view = false;
  // A window's own title, which the desktop shows instead of its page's;
  // empty for none. Never a view's.
  std::string title;
  // Whether the window opens hidden, as `show: false`. Never a view.
  bool hidden = false;
};

// Where a window holds one of its views, in CSS pixels from the top left of
// the window's page, as the app asked: the shell lays the view out there or
// elsewhere.
struct ElectronViewPlacement {
  ElectronWindow view;
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  bool hidden = false;

  friend bool operator==(const ElectronViewPlacement&,
                         const ElectronViewPlacement&) = default;
};

// contentView.addChildView and friends: the views `window` holds, bottom
// first, replacing the ones it held before.
struct ElectronSetViews {
  ElectronWindow window;
  std::vector<ElectronViewPlacement> views;
};

// Menu.setApplicationMenu, win.setMenu, setMenuBarVisibility and
// setAutoHideMenuBar: the menu bar the shell draws under `window`'s tab.
struct ElectronSetMenuBar {
  ElectronWindow window;
  // The menu's entries as JSON, checked and with only the keys the shell
  // reads; empty for no menu. See ElectronMenuJson.
  std::string menu;
  // Whether the bar shows. With `auto_hide`, it shows while Alt is held or
  // after Alt is tapped, as Electron's autoHideMenuBar.
  bool visible = true;
  bool auto_hide = false;
};

// Menu.popup: a menu the shell draws over `window`'s page, which the app knows
// as `popup` until it closes. At `x` and `y`, in CSS pixels from the page's
// top left, or where the user last pressed in the page without them.
struct ElectronPopupMenu {
  ElectronWindow window;
  int popup = 0;
  // The menu's entries as JSON, checked and with only the keys the shell
  // reads. See ElectronMenuJson.
  std::string menu;
  std::optional<int> x;
  std::optional<int> y;
};

// Menu.closePopup: puts away popup `popup` over `window`, if it still shows.
struct ElectronClosePopupMenu {
  ElectronWindow window;
  int popup = 0;
};

// dialog.showMessageBox: a question the shell asks over `window`, which the
// app knows as `box` until it is answered.
struct ElectronShowMessageBox {
  ElectronWindow window;
  int box = 0;
  // The box as JSON, checked and with only the keys the shell reads: "type",
  // "title", "message", "detail", "buttons", "defaultId" (-1 for none),
  // "cancelId", "checkboxLabel" and "checkboxChecked".
  std::string message_box;
  // How many buttons it has, and the one that answers when the shell can't.
  int buttons = 0;
  int cancel_id = 0;
};

struct ElectronLoadUrl {
  ElectronWindow window;
  GURL url;
};

struct ElectronFocusWindow {
  ElectronWindow window;
};

// navigationHistory.goToIndex: shows entry `index` of the history the last
// page_state listed.
struct ElectronGoToIndex {
  ElectronWindow window;
  int index = 0;
};

// navigationHistory.clear: forgets every entry but the one shown.
struct ElectronClearHistory {
  ElectronWindow window;
};

// What webContents.undo and the rest of the Edit menu do at the page's focus.
enum class ElectronEditCommand {
  kUndo,
  kRedo,
  kCut,
  kCopy,
  kPaste,
  kPasteAndMatchStyle,
  kDelete,
  kSelectAll,
  kUnselect,
  kCenterSelection,
};

struct ElectronEdit {
  ElectronWindow window;
  ElectronEditCommand command = ElectronEditCommand::kUndo;
};

// webContents.replace, or replaceMisspelling: `text` in place of the word at
// the selection.
struct ElectronReplace {
  ElectronWindow window;
  std::string text;
  bool misspelling = false;
};

// webContents.findInPage: search `request`, which the app numbers, for
// `text`. `find_next` goes on with the search before it instead of starting
// over.
struct ElectronFindInPage {
  ElectronWindow window;
  int request = 0;
  std::string text;
  bool forward = true;
  bool find_next = false;
  bool match_case = false;
};

// What webContents.stopFindInPage does with the match it leaves.
enum class ElectronStopFindAction {
  kClearSelection,
  kKeepSelection,
  kActivateSelection,
};

struct ElectronStopFindInPage {
  ElectronWindow window;
  ElectronStopFindAction action = ElectronStopFindAction::kClearSelection;
};

// A find_in_page search's last answer: how many matches the page has, which
// is selected (from 1; 0 for none) and where it is, in the page's CSS pixels.
struct ElectronFindResult {
  int request = 0;
  int matches = 0;
  int active_match_ordinal = 0;
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;

  friend bool operator==(const ElectronFindResult&,
                         const ElectronFindResult&) = default;
};

// What an app's webContents knows of its page, sent whenever it changes.
struct ElectronPageState {
  struct Entry {
    std::string url;
    std::string title;

    friend bool operator==(const Entry&, const Entry&) = default;
  };
  // The page's history, oldest first, and the entry it shows.
  std::vector<Entry> entries;
  int index = 0;
  // A navigation is under way.
  bool loading = false;
  // The page has the keyboard focus.
  bool focused = false;
  // Its renderer's process id; 0 before it has one.
  int pid = 0;
  // Its renderer is gone, and the page with it, until it loads again.
  bool crashed = false;

  friend bool operator==(const ElectronPageState&,
                         const ElectronPageState&) = default;
};

struct ElectronCloseWindow {
  ElectronWindow window;
};

// win.setTitle, and a page title the app let through: the title the desktop
// shows for `window` from now on, over its page's.
struct ElectronSetTitle {
  ElectronWindow window;
  std::string title;
};

// win.hide and win.show: a hidden window stays open, its page running, and
// the desktop doesn't show it.
struct ElectronSetHidden {
  ElectronWindow window;
  bool hidden = false;
};

// app.userAgentFallback: the user agent of the pages of each session that
// has none of its own.
struct ElectronSetUserAgentFallback {
  std::string user_agent;
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

// webContents.executeJavaScript: runs `code` in the main world of window
// `window`'s page, as if the user had acted when `user_gesture`, and answers
// with ElectronJavaScriptResult under `call`, once a promise it gives settles.
struct ElectronExecuteJavaScript {
  ElectronWindow window;
  int call = 0;
  std::string code;
  bool user_gesture = false;

  friend bool operator==(const ElectronExecuteJavaScript&,
                         const ElectronExecuteJavaScript&) = default;
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

// Session `session` has a permission request handler, or no longer has one.
// While it has one, its pages' permission requests ask the app instead of the
// shell.
struct ElectronPermissionHandler {
  std::string session;
  bool handle = false;

  friend bool operator==(const ElectronPermissionHandler&,
                         const ElectronPermissionHandler&) = default;
};

// The handler's answer to permission request `ask`.
struct ElectronPermissionAnswer {
  int ask = 0;
  bool granted = false;

  friend bool operator==(const ElectronPermissionAnswer&,
                         const ElectronPermissionAnswer&) = default;
};

// A window a page asked for, as setWindowOpenHandler's details have it.
struct ElectronWindowOpenDetails {
  GURL url;
  // window.open's target; empty for none.
  std::string frame_name;
  // window.open's features, as "width=500,height=600,left=0,top=0" from what
  // Blink kept of them; empty for none.
  std::string features;
  // "default", "foreground-tab", "background-tab", "new-window" or "other".
  std::string disposition;
  // The page that asked; empty when it sends no referrer.
  GURL referrer;

  friend bool operator==(const ElectronWindowOpenDetails&,
                         const ElectronWindowOpenDetails&) = default;
};

// The app's answer to window_open `ask`: the window to open, its url left
// empty for the one the page asked for, or none for a denial.
struct ElectronWindowOpenAnswer {
  int ask = 0;
  std::optional<ElectronOpenWindow> open;
};

// A page's permission request as setPermissionRequestHandler sees it.
struct ElectronPermissionDetails {
  // Electron's name for it: "media", "geolocation", "notifications"...
  std::string permission;
  // The origin that asked.
  GURL requesting_url;
  // "media"'s kinds: "video", "audio".
  std::vector<std::string> media_types;

  friend bool operator==(const ElectronPermissionDetails&,
                         const ElectronPermissionDetails&) = default;
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
                                     ElectronGoToIndex,
                                     ElectronClearHistory,
                                     ElectronEdit,
                                     ElectronReplace,
                                     ElectronFindInPage,
                                     ElectronStopFindInPage,
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
                                     ElectronSessionCall,
                                     ElectronPermissionHandler,
                                     ElectronPermissionAnswer,
                                     ElectronWindowOpenAnswer,
                                     ElectronSetViews,
                                     ElectronSetMenuBar,
                                     ElectronShowMessageBox,
                                     ElectronPopupMenu,
                                     ElectronClosePopupMenu,
                                     ElectronExecuteJavaScript,
                                     ElectronSetTitle,
                                     ElectronSetHidden,
                                     ElectronSetUserAgentFallback>;

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
std::string ElectronReady(const std::vector<ElectronScheme>& schemes,
                          const ElectronEngineInfo& engine);
// The answer to window `window`'s executeJavaScript `call`: what the code
// gave, or why it gave nothing.
std::string ElectronJavaScriptResult(
    ElectronWindow window,
    int call,
    const base::expected<base::Value, std::string>& result);
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
std::string ElectronWindowDomReady(ElectronWindow window);
std::string ElectronTitleChanged(ElectronWindow window, std::string_view title);
std::string ElectronWindowClosed(ElectronWindow window);
// The user asked to close `window`, which closes only if the app closes it.
std::string ElectronCloseAsked(ElectronWindow window);
// What `window`'s page is now.
std::string ElectronPageStateChanged(ElectronWindow window,
                                     const ElectronPageState& state);
// A find_in_page search in `window`'s page is done.
std::string ElectronFoundInPage(ElectronWindow window,
                                const ElectronFindResult& result);
// The size, in CSS pixels, the shell gave window or view `window`'s page.
std::string ElectronWindowResized(ElectronWindow window, int width, int height);
// The user clicked entry `command` of `window`'s menu bar.
std::string ElectronMenuClicked(ElectronWindow window, int command);
// Popup menu `popup` over `window` closed: the user chose entry `command`,
// or 0 when it was put away with nothing chosen.
std::string ElectronPopupMenuClosed(ElectronWindow window,
                                    int popup,
                                    int command);
// Message box `box` over `window` was answered with button `response`, and
// its checkbox left checked or not.
std::string ElectronMessageBoxAnswered(ElectronWindow window,
                                       int box,
                                       int response,
                                       bool checkbox_checked);

// `menu`, a list of menu entries, as the JSON the shell reads, or why it is
// not one. Each entry is an object with a whole "id" from 1, a "type"
// (normal, separator, submenu, checkbox or radio), a string "label", true or
// false "enabled", "visible" and "checked", and optionally a string
// "accelerator", a PNG data: URL "icon" and a "submenu" list of entries.
base::expected<std::string, std::string> ElectronMenuJson(
    const base::ListValue& menu);
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
// Window `window`'s page asked for a window, `details`: ask `ask` waits for
// window_open_answer.
std::string ElectronWindowOpen(int ask,
                               ElectronWindow window,
                               const ElectronWindowOpenDetails& details);
// Permission request `ask` in session `session`, made by window `window`'s
// page when it was one; it waits for permission_answer.
std::string ElectronPermissionRequest(int ask,
                                      std::optional<ElectronWindow> window,
                                      std::string_view session,
                                      const ElectronPermissionDetails& details);
std::string ElectronProtocolRequest(int request,
                                    std::string_view session,
                                    const ElectronFetch& fetch);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_ELECTRON_PROTOCOL_H_
