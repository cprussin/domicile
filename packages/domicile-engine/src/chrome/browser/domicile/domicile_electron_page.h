// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_PAGE_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_PAGE_H_

#include <string>

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

  // webContents.send to `contents`, when it is an Electron window's page.
  static void SendTo(content::WebContents& contents,
                     const std::string& channel,
                     const std::string& args_json);

  // content::WebContentsObserver:
  void ReadyToCommitNavigation(content::NavigationHandle* navigation) override;

  // mojom::ElectronFrameHost:
  void Send(const std::string& channel, const std::string& args_json) override;
  void Invoke(const std::string& channel,
              const std::string& args_json,
              InvokeCallback callback) override;

 private:
  friend class content::WebContentsUserData<ElectronPage>;

  ElectronPage(content::WebContents* contents,
               std::string preload,
               ElectronPageCalls calls);

  // The page's arguments as a list, or nothing after reporting the renderer.
  std::optional<base::ListValue> ArgsFrom(const std::string& args_json);

  const std::string preload_;
  const ElectronPageCalls calls_;
  // The document that last committed with the preload, or is about to.
  mojo::AssociatedRemote<mojom::ElectronFrame> frame_;
  mojo::AssociatedReceiver<mojom::ElectronFrameHost> receiver_{this};

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_PAGE_H_
