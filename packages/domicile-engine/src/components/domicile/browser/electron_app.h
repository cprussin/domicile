// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_ELECTRON_APP_H_
#define COMPONENTS_DOMICILE_BROWSER_ELECTRON_APP_H_

#include <map>
#include <optional>
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
};

// What an Electron app's windows are on the desk: app windows, named by the
// desk's own window ids. //chrome implements it over its browser windows.
class ElectronDesk {
 public:
  virtual ~ElectronDesk() = default;

  // Opens an app window at `url` for `hello`'s app, whose pages run
  // `preload` (none when empty) and make `calls`. Returns its id, or nothing
  // when there is no shell to open it in.
  virtual std::optional<std::string> Open(const GURL& url,
                                          const ElectronHello& hello,
                                          const std::string& preload,
                                          ElectronPageCalls calls) = 0;
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
};

// One connection to the Electron socket: one running app. Turns its request
// lines into calls on the desk, and what happens to its windows into event
// lines. See electron_protocol.h. UI thread only.
class ElectronApp {
 public:
  using Send = base::RepeatingCallback<void(std::string line)>;

  ElectronApp(ElectronDesk& desk, Send send);
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
  struct Window {
    std::string id;
    std::string title;
  };

  void Open(const ElectronOpenWindow& open);
  void Reply(ElectronReply reply);
  void PageSent(ElectronWindow number,
                std::string channel,
                base::ListValue args);
  void PageInvoked(ElectronWindow number,
                   std::string channel,
                   base::ListValue args,
                   ElectronAnswer answer);
  // The desk id of window `number`, or nothing after refusing the request.
  std::optional<std::string> IdOf(ElectronWindow number);

  const raw_ref<ElectronDesk> desk_;
  const Send send_;
  // Set by the app's hello.
  std::optional<ElectronHello> hello_;
  // The app's open windows, by the numbers it gave them.
  std::map<ElectronWindow, Window> windows_;
  // The pages' invokes waiting on the app's handlers, by number.
  std::map<int, ElectronAnswer> invokes_;
  int next_invoke_ = 1;
  base::WeakPtrFactory<ElectronApp> weak_factory_{this};
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_ELECTRON_APP_H_
