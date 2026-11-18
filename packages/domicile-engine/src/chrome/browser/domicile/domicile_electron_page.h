// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_PAGE_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_PAGE_H_

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/memory/weak_ptr.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "components/domicile/browser/electron_app.h"
#include "components/domicile/mojom/electron_frame.mojom.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "mojo/public/cpp/bindings/associated_receiver.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "ui/gfx/geometry/size.h"

namespace base {
class CommandLine;
}

class GURL;

namespace content {
class RenderFrameHost;
class RenderProcessHost;
class SiteInstance;
}  // namespace content

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

  // Makes `contents` an Electron window's page whose documents run `preload`,
  // make `calls` and load through `session`. Before its first navigation, so
  // a `node` page's first renderer starts as one. A `node` page has Node.js,
  // as a window that isn't sandboxed has in Electron, and its preload is a
  // file, `node->preload`, rather than `preload`.
  static void Attach(content::WebContents& contents,
                     std::string preload,
                     std::optional<ElectronNode> node,
                     ElectronPageCalls calls,
                     base::WeakPtr<ElectronSession> session);

  // `frame`, a main frame, navigates into `site_instance`. When `frame` is a
  // Node page's, the renderer the navigation goes to is to start for Node:
  // marked now, or, when `site_instance` has none yet, as it gets one. Before
  // that renderer starts, from
  // ChromeContentBrowserClient::MainFrameNavigatesInto.
  static void MainFrameNavigatesInto(content::RenderFrameHost& frame,
                                     content::SiteInstance& site_instance);

  // `site_instance` got its renderer, which is to start for Node when a Node
  // page's navigation goes into it. From
  // ChromeContentBrowserClient::SiteInstanceGotProcessAndSite.
  static void SiteInstanceGotProcess(content::SiteInstance& site_instance);

  // Whether a Node page's navigation to `site_url` waits for its renderer:
  // it takes no spare, which started sandboxed. From
  // ChromeContentBrowserClient::ShouldUseSpareRenderProcessHost.
  static bool RefusesSpareRenderer(const GURL& site_url);

  // Whether `host` may take a navigation to `site_url`: a Node page's takes
  // only a renderer marked for Node, never one that started sandboxed. From
  // ChromeContentBrowserClient::IsSuitableHost.
  static bool IsSuitableHost(content::RenderProcessHost& host,
                             const GURL& site_url);

  // Starts `host` for Node.js when it is to run a Node page: unsandboxed and
  // without the zygote, as Electron starts such a renderer, marked for the
  // renderer to start Node. As it is about to launch, from
  // ChromeContentBrowserClient::AppendExtraCommandLineSwitches.
  static void AppendRendererSwitches(content::RenderProcessHost& host,
                                     base::CommandLine& command_line);

  // Whether `host` was started for a Node page.
  static bool IsNodeRenderer(content::RenderProcessHost& host);

  // Whether `host` is for a Node page, started or about to be: such a
  // renderer is its page's alone, from
  // ChromeContentBrowserClient::MayReuseHost.
  static bool IsForNode(content::RenderProcessHost& host);

  // The session `contents` loads through when it is an Electron window's
  // page and its app still runs; otherwise null.
  static base::WeakPtr<ElectronSession> SessionOf(
      content::WebContents& contents);

  // The app's IPC to the page, each dropped while no document with the
  // preload is up, as nothing in the page could hear it. webContents.send:
  void Deliver(const std::string& channel, const std::string& args_json);
  // webContents.postMessage:
  void DeliverPost(const std::string& channel,
                   const std::string& message_json,
                   const std::vector<std::string>& ports);
  // webContents.executeJavaScript, in the document now up: `done` runs once,
  // with what the code gave or why it gave nothing.
  void ExecuteJavaScript(
      const std::string& code,
      bool user_gesture,
      base::OnceCallback<void(base::expected<base::Value, std::string>)> done);
  // The user clicked entry `command` of the window's menu bar.
  void MenuClicked(int command);
  // The user asked to close the window: the app decides.
  void CloseAsked();

  // A message on a port, and the main process closing one:
  void DeliverToPort(const std::string& port, const std::string& data_json);
  void ClosePort(const std::string& port);

  // content::WebContentsObserver:
  void ReadyToCommitNavigation(content::NavigationHandle* navigation) override;
  // Each tells the app the page's new size, for getContentBounds and
  // "resize". All of them: which one fires for a guest's page is Chromium's,
  // and a size heard twice is sent once. A page the shell sized before its
  // document's widget was made hears no resize, so a new page and a finished
  // load report the size too.
  void PrimaryMainFrameWasResized(bool width_changed) override;
  void FrameSizeChanged(content::RenderFrameHost* frame,
                        const gfx::Size& frame_size) override;
  void PrimaryPageChanged(content::Page& page) override;
  void DidFinishLoad(content::RenderFrameHost* frame, const GURL& url) override;

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
               std::optional<ElectronNode> node,
               ElectronPageCalls calls,
               base::WeakPtr<ElectronSession> session);

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

  // Whether a document has a preload, or Node, and so hears IPC.
  bool HasPreload() const;

  const std::string preload_;
  const std::optional<ElectronNode> node_;
  const ElectronPageCalls calls_;
  const base::WeakPtr<ElectronSession> session_;
  // The document that last committed, or is about to: its preload, IPC and
  // the app's scripts.
  mojo::AssociatedRemote<mojom::ElectronFrame> frame_;
  mojo::AssociatedReceiver<mojom::ElectronFrameHost> receiver_{this};
  // The size last told to the app, so a resize that changes nothing says
  // nothing.
  // Sends the page's view size to the app if it changed. `heard` names what
  // said so, for the log.
  void ReportSize(std::string_view heard);

  gfx::Size size_;

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_PAGE_H_
