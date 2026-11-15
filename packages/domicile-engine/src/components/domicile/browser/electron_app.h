// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_ELECTRON_APP_H_
#define COMPONENTS_DOMICILE_BROWSER_ELECTRON_APP_H_

#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ref.h"
#include "base/memory/weak_ptr.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "components/domicile/browser/browser_window_listing.h"
#include "components/domicile/browser/electron_protocol.h"
#include "components/domicile/browser/web_view_partition.h"
#include "url/gurl.h"

namespace domicile {

// An ipcMain handler's answer to an invoke: its result, or why it failed.
using ElectronAnswer =
    base::OnceCallback<void(base::expected<base::Value, std::string>)>;

// What a window's page says to its app through its preload's ipcRenderer.
struct ElectronPageCalls {
  // ipcRenderer.send.
  base::RepeatingCallback<void(std::string channel, base::ListValue args)> sent;
  // ipcRenderer.invoke. The answer may come after the page is gone.
  base::RepeatingCallback<
      void(std::string channel, base::ListValue args, ElectronAnswer answer)>
      invoked;
  // ipcRenderer.sendSync: as invoked, while the page waits.
  base::RepeatingCallback<
      void(std::string channel, base::ListValue args, ElectronAnswer answer)>
      sent_sync;
  // ipcRenderer.postMessage, with the names of the page's ports that went.
  base::RepeatingCallback<void(std::string channel,
                               base::Value message,
                               std::vector<std::string> ports)>
      posted;
  // A message on one of the page's ports, and the page closing one.
  base::RepeatingCallback<void(std::string port, base::Value data)> port_posted;
  base::RepeatingCallback<void(std::string port)> port_closed;
  // A new document replaced the page, its ports and listeners with it.
  base::RepeatingClosure gone;
};

// Where a page's protocol request is answered: the loader that made it. The
// app calls Respond or Fail once; after a streamed Respond, Data until End.
// Destroying a responder that has not finished fails its request, as when
// the app goes.
class ElectronResponder {
 public:
  virtual ~ElectronResponder() = default;

  virtual void Respond(ElectronResponse response) = 0;
  // Why the app's handler failed, instead of a response.
  virtual void Fail(const std::string& why) = 0;
  // A piece of a streamed body.
  virtual void Data(std::string bytes) = 0;
  // A streamed body is complete, or broke off for `error`.
  virtual void End(const std::optional<std::string>& error) = 0;
};

class ElectronApp;

// Where a waiting request hears the app's answer to one of its webRequest
// events.
using ElectronWebRequestAnswered =
    base::OnceCallback<void(ElectronWebRequestAnswer)>;

// One of an app's sessions, as its pages' loaders see it: which schemes the
// app handles there, and the way to its handlers. Lives as long as its app.
class ElectronSession {
 public:
  ElectronSession(ElectronApp& app, std::string name);
  ElectronSession(const ElectronSession&) = delete;
  ElectronSession& operator=(const ElectronSession&) = delete;
  ~ElectronSession();

  // Whether the app handles `scheme`'s requests in this session.
  bool Handles(std::string_view scheme) const;
  // The schemes it handles that the network does not: file: and the app's
  // own, which a document needs a loader for before it asks.
  std::vector<std::string> LocalSchemes() const;
  // Asks the app's handler for `fetch`, a request in a scheme it handles.
  void Fetch(ElectronFetch fetch, std::unique_ptr<ElectronResponder> responder);

  // Whether the app has a webRequest listener for `event` in this session.
  bool ListensFor(ElectronWebRequestEvent event) const;
  // Whether it has any.
  bool ListensForWebRequests() const { return !web_request_events_.empty(); }
  // Asks the app's listener for `event`, one a request waits on, about a
  // request desk window `window`'s page made (nothing when no window's page
  // made it). `answered` runs once, with the answer or, when the app goes
  // first, with a cancel.
  void AskWebRequest(ElectronWebRequestEvent event,
                     const std::optional<std::string>& window,
                     ElectronWebRequestDetails details,
                     ElectronWebRequestAnswered answered);
  // Tells the app's listener of `event`, one nothing waits on.
  void TellWebRequest(ElectronWebRequestEvent event,
                      const std::optional<std::string>& window,
                      ElectronWebRequestDetails details);

  const std::string& name() const { return name_; }
  base::WeakPtr<ElectronSession> GetWeakPtr() {
    return weak_factory_.GetWeakPtr();
  }

 private:
  friend class ElectronApp;

  const raw_ref<ElectronApp> app_;
  const std::string name_;
  std::set<std::string> schemes_;
  std::set<ElectronWebRequestEvent> web_request_events_;
  base::WeakPtrFactory<ElectronSession> weak_factory_{this};
};

// What an Electron app's windows are on the desk: app windows, named by the
// desk's own window ids. //chrome implements it over its browser windows.
class ElectronDesk {
 public:
  virtual ~ElectronDesk() = default;

  // Opens an app window at `url` for app `app_id`, in `partition`, whose
  // pages run `preload` (none when empty), make `calls` and load through
  // `session`. Returns its id, or nothing when there is no shell to open it
  // in.
  virtual std::optional<std::string> Open(
      const GURL& url,
      const std::string& app_id,
      const WebViewPartition& partition,
      const std::string& preload,
      ElectronPageCalls calls,
      base::WeakPtr<ElectronSession> session) = 0;
  virtual void Load(const std::string& id, const GURL& url) = 0;
  virtual void Focus(const std::string& id) = 0;
  // Closes window `id` once its page agrees.
  virtual void AskToClose(const std::string& id) = 0;
  // Closes window `id` without asking.
  virtual void Close(const std::string& id) = 0;
  // webContents.send: `args_json`, a JSON array, on `channel` to window
  // `id`'s page, for its preload's ipcRenderer.
  virtual void SendToPage(const std::string& id,
                          const std::string& channel,
                          const std::string& args_json) = 0;
  // webContents.postMessage: `message_json` on `channel`, and a port in the
  // page for each of `ports`.
  virtual void PostToPage(const std::string& id,
                          const std::string& channel,
                          const std::string& message_json,
                          const std::vector<std::string>& ports) = 0;
  // `data_json` on port `port`, to its end in window `id`'s page.
  virtual void PostToPort(const std::string& id,
                          const std::string& port,
                          const std::string& data_json) = 0;
  // Closes port `port`'s end in window `id`'s page.
  virtual void ClosePort(const std::string& id, const std::string& port) = 0;
};

// One connection to the Electron socket: one running app. Turns its request
// lines into calls on the desk, and what happens to its windows into event
// lines. See electron_protocol.h. UI thread only.
class ElectronApp {
 public:
  using Send = base::RepeatingCallback<void(std::string line)>;

  // `schemes` are the apps' own schemes the engine registered as it
  // started, which hello's answer names.
  ElectronApp(ElectronDesk& desk,
              Send send,
              std::vector<ElectronScheme> schemes = {});
  ElectronApp(const ElectronApp&) = delete;
  ElectronApp& operator=(const ElectronApp&) = delete;
  // Closes the app's windows: an app whose main process is gone cannot run
  // them.
  ~ElectronApp();

  // Answers one request line.
  void Take(std::string_view line);

  // Reports the app's windows that closed or changed title, from the desk's
  // whole list of browser windows.
  void Listed(const std::vector<ListedBrowserWindow>& listing);

  // Reports that window `id`'s page finished loading. Any other id is not
  // this app's.
  void Loaded(const std::string& id);

 private:
  friend class ElectronSession;

  struct Window {
    std::string id;
    std::string title;
    // Its session, by its Electron partition.
    std::string session;
  };

  // A page's protocol request, waiting on the app's handler.
  struct Pending {
    std::unique_ptr<ElectronResponder> responder;
    // Responded with a body that follows in pieces.
    bool streaming = false;
  };

  // A request waiting on the app's answer to one of its webRequest events.
  struct Ask {
    ElectronWebRequestEvent event;
    ElectronWebRequestAnswered answered;
  };

  // Session `name`, made the first time the app names it.
  ElectronSession& SessionNamed(const std::string& name);
  void HandleProtocol(const ElectronHandleProtocol& handle);
  void ListenForWebRequests(ElectronWebRequestListen listen);
  void SendWebRequest(const std::string& session,
                      ElectronWebRequestEvent event,
                      std::optional<int> ask,
                      const std::optional<std::string>& window,
                      const ElectronWebRequestDetails& details);
  void StartAsk(const std::string& session,
                ElectronWebRequestEvent event,
                const std::optional<std::string>& window,
                const ElectronWebRequestDetails& details,
                ElectronWebRequestAnswered answered);
  void Answer(ElectronWebRequestAnswer answer);
  void StartFetch(const std::string& session,
                  ElectronFetch fetch,
                  std::unique_ptr<ElectronResponder> responder);
  void Respond(ElectronProtocolResponse response);
  void ReceiveData(ElectronProtocolData data);
  void EndBody(const ElectronProtocolEnd& end);
  // Fails protocol request `request` for the app's bad line, `why`.
  void FailRequest(int request, const std::string& why);
  // Whether `url` opens in session `session`'s windows, or else refuses
  // window `number`'s request.
  bool Opens(ElectronWindow number,
             const std::string& session,
             const GURL& url);

  void Open(const ElectronOpenWindow& open);
  void Reply(ElectronReply reply);
  void PageSent(ElectronWindow number,
                std::string channel,
                base::ListValue args);
  // ipcRenderer.invoke and sendSync, which differ only in their event.
  void PageInvoked(ElectronWindow number,
                   bool sync,
                   std::string channel,
                   base::ListValue args,
                   ElectronAnswer answer);
  void PagePosted(ElectronWindow number,
                  std::string channel,
                  base::Value message,
                  std::vector<std::string> ports);
  void PagePortPosted(ElectronWindow number,
                      std::string port,
                      base::Value data);
  void PagePortClosed(ElectronWindow number, std::string port);
  void PageGone(ElectronWindow number);
  // The desk id of window `number`, or nothing after refusing the request.
  std::optional<std::string> IdOf(ElectronWindow number);

  const raw_ref<ElectronDesk> desk_;
  const Send send_;
  const std::vector<ElectronScheme> schemes_;
  // Set by the app's hello.
  std::optional<ElectronHello> hello_;
  // The app's open windows, by the numbers it gave them.
  std::map<ElectronWindow, Window> windows_;
  // The pages' invokes waiting on the app's handlers, by number.
  std::map<int, ElectronAnswer> invokes_;
  int next_invoke_ = 1;
  // The app's sessions, by Electron partition, "" its own.
  std::map<std::string, std::unique_ptr<ElectronSession>> sessions_;
  // The pages' protocol requests waiting on the app, by number.
  std::map<int, Pending> fetches_;
  int next_fetch_ = 1;
  // The requests waiting on the app's webRequest listeners, by ask.
  std::map<int, Ask> asks_;
  int next_ask_ = 1;
  base::WeakPtrFactory<ElectronApp> weak_factory_{this};
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_ELECTRON_APP_H_
