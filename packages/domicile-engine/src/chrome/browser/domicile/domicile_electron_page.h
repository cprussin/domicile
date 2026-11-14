// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_PAGE_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_PAGE_H_

#include <optional>
#include <string>
#include <vector>

#include "base/values.h"
#include "components/domicile/browser/electron_app.h"
#include "components/domicile/mojom/electron_frame.mojom.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "mojo/public/cpp/bindings/associated_receiver.h"
#include "mojo/public/cpp/bindings/associated_remote.h"

namespace domicile {

// An Electron app window's page, in the browser: sends its preload to the
// main frame before each navigation commits, and carries its ipcRenderer to
// the app and the app's webContents.send to it. The renderer half is
// components/domicile/renderer/electron_preload.h.
class ElectronPage final : public content::WebContentsObserver,
                           public content::WebContentsUserData<ElectronPage>,
                           public mojom::ElectronFrameHost {
 public:
  ElectronPage(const ElectronPage&) = delete;
  ElectronPage& operator=(const ElectronPage&) = delete;
  ~ElectronPage() override;

  // Makes `contents` an Electron window's page whose documents run `preload`
  // and make `calls`. Before its first navigation.
  static void Attach(content::WebContents& contents,
                     std::string preload,
                     ElectronPageCalls calls);

  // The app's IPC to the page, each dropped while no document with the
  // preload is up, as nothing in the page could hear it. webContents.send:
  void Deliver(const std::string& channel, const std::string& args_json);
  // webContents.postMessage:
  void DeliverPost(const std::string& channel,
                   const std::string& message_json,
                   const std::vector<std::string>& ports);
  // A message on a port, and the main process closing one:
  void DeliverToPort(const std::string& port, const std::string& data_json);
  void ClosePort(const std::string& port);

  // content::WebContentsObserver:
  void ReadyToCommitNavigation(content::NavigationHandle* navigation) override;

  // mojom::ElectronFrameHost:
  void Send(const std::string& channel, const std::string& args_json) override;
  void Invoke(const std::string& channel,
              const std::string& args_json,
              InvokeCallback callback) override;
  void SendSync(const std::string& channel,
                const std::string& args_json,
                SendSyncCallback callback) override;
  void Post(const std::string& channel,
            const std::string& message_json,
            const std::vector<std::string>& ports) override;
  void PostToPort(const std::string& port,
                  const std::string& data_json) override;
  void PortClosed(const std::string& port) override;

 private:
  friend class content::WebContentsUserData<ElectronPage>;

  ElectronPage(content::WebContents* contents,
               std::string preload,
               ElectronPageCalls calls);

  // The page's arguments as a list, or nothing after reporting the renderer.
  std::optional<base::ListValue> ArgsFrom(const std::string& args_json);
  // The page's JSON, or nothing after reporting the renderer.
  std::optional<base::Value> JsonFrom(const std::string& json);
  // Whether `port` names a port the page made, after reporting the renderer
  // when it does not.
  bool IsPagePort(const std::string& port);
  // Whether `port` names a port at all, after reporting the renderer when it
  // does not.
  bool IsPort(const std::string& port);

  const std::string preload_;
  const ElectronPageCalls calls_;
  // The document that last committed with the preload, or is about to.
  mojo::AssociatedRemote<mojom::ElectronFrame> frame_;
  mojo::AssociatedReceiver<mojom::ElectronFrameHost> receiver_{this};

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_PAGE_H_
