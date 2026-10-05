// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_devtools.h"

#include <memory>
#include <string>
#include <vector>

#include "base/check.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "chrome/browser/devtools/devtools_ui_bindings.h"
#include "components/domicile/browser/web_view_guest.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "ui/gfx/geometry/rect.h"
#include "url/gurl.h"

namespace domicile {
namespace {

// Chrome's kDefaultFrontendURL without DevToolsWindow's docking, remote-base
// and tab-target parameters. Sanitized, because DevToolsUIBindings binds only
// sanitized front end URLs.
GURL FrontendURL() {
  return DevToolsUIBindings::SanitizeFrontendURL(
      GURL("devtools://devtools/bundled/devtools_app.html"));
}

// Pages waiting for a DevTools window, oldest first. The next <webview> to
// load the front end takes the oldest.
std::vector<scoped_refptr<content::DevToolsAgentHost>>& Waiting() {
  static base::NoDestructor<
      std::vector<scoped_refptr<content::DevToolsAgentHost>>>
      waiting;
  return *waiting;
}

// <webview>s with DevTools attached, so a second request focuses the existing
// window.
std::vector<base::WeakPtr<content::WebContents>>& Frontends() {
  static base::NoDestructor<std::vector<base::WeakPtr<content::WebContents>>>
      frontends;
  return *frontends;
}

// The <webview> DevTools for `agent` is open in, or null.
content::WebContents* FrontendFor(content::DevToolsAgentHost& agent) {
  std::erase_if(Frontends(), [](const base::WeakPtr<content::WebContents>& f) {
    return !f;
  });
  for (const base::WeakPtr<content::WebContents>& frontend : Frontends()) {
    DevToolsUIBindings* bindings =
        DevToolsUIBindings::ForWebContents(frontend.get());
    if (bindings != nullptr && bindings->IsAttachedTo(&agent)) {
      return frontend.get();
    }
  }
  return nullptr;
}

// The guest behind `contents`, which is always a <webview>'s here.
WebViewGuest& GuestOf(content::WebContents* contents) {
  WebViewGuest* guest = WebViewGuest::FromWebContents(contents);
  CHECK(guest);
  return *guest;
}

// Answers DevTools' window requests with desk browser windows. Chrome's
// DevToolsWindow implements the same interface on a Browser.
class WebViewDevToolsDelegate : public DevToolsUIBindings::Delegate {
 public:
  WebViewDevToolsDelegate(content::WebContents& frontend,
                          content::WebContents* inspected)
      : frontend_(&frontend),
        inspected_(inspected == nullptr ? nullptr : inspected->GetWeakPtr()) {}

  content::WebContents* GetInspectedWebContents() override {
    return inspected_.get();
  }
  void ActivateWindow() override { GuestOf(frontend_).RequestFocus(); }
  void CloseWindow() override { GuestOf(frontend_).RequestClose(); }
  // A worker or another target: open another window.
  void Inspect(scoped_refptr<content::DevToolsAgentHost> host) override {
    Waiting().push_back(std::move(host));
    GuestOf(frontend_).RequestWindow(FrontendURL());
  }
  void OpenInNewTab(const std::string& url) override {
    GuestOf(frontend_).RequestWindow(GURL(url));
  }
  // Close with the inspected page, as Chrome does.
  void InspectedContentsClosing() override {
    GuestOf(frontend_).RequestClose();
  }

  // Never docked, and draws no browser UI.
  void SetInspectedPageBounds(const gfx::Rect& rect) override {}
  void InspectElementCompleted() override {}
  void SetIsDocked(bool is_docked) override {}
  void OpenSearchResultsInNewTab(const std::string& query) override {}
  void SetWhitelistedShortcuts(const std::string& message) override {}
  void SetEyeDropperActive(bool active) override {}
  void OpenNodeFrontend() override {}
  void OnLoadCompleted() override {}
  void ReadyForTest() override {}
  void ConnectionReady() override {}
  void SetOpenNewWindowForPopups(bool value) override {}
  infobars::ContentInfoBarManager* GetInfoBarManager() override {
    return nullptr;
  }
  void RenderProcessGone(bool crashed) override {}
  void ShowCertificateViewer(const std::string& cert_chain) override {}
  int GetDockStateForLogging() override { return 0; }
  int GetOpenedByForLogging() override { return 0; }
  int GetClosedByForLogging() override { return 0; }

 private:
  // The bindings own this, and the front end's page owns the bindings.
  const raw_ptr<content::WebContents> frontend_;
  const base::WeakPtr<content::WebContents> inspected_;
};

// Attaches DevTools when a guest commits the front end and a page is waiting.
class DevToolsFrontendWatcher
    : public content::WebContentsObserver,
      public content::WebContentsUserData<DevToolsFrontendWatcher> {
 public:
  ~DevToolsFrontendWatcher() override = default;

  void DidFinishNavigation(content::NavigationHandle* navigation) override {
    if (!navigation->IsInPrimaryMainFrame() || !navigation->HasCommitted() ||
        navigation->IsSameDocument() ||
        !DevToolsUIBindings::IsValidFrontendURL(navigation->GetURL())) {
      return;
    }
    // DevToolsUI makes these for every front end it serves.
    DevToolsUIBindings* bindings =
        DevToolsUIBindings::ForWebContents(web_contents());
    CHECK(bindings);
    // A reload: the bindings attach themselves again.
    if (bindings->agent_host() != nullptr) {
      return;
    }
    if (Waiting().empty()) {
      LOG(WARNING) << "domicile: a <webview> loaded DevTools with no page "
                      "waiting for it; it inspects nothing.";
      return;
    }
    scoped_refptr<content::DevToolsAgentHost> agent = Waiting().front();
    Waiting().erase(Waiting().begin());

    bindings->SetDelegate(
        new WebViewDevToolsDelegate(*web_contents(), agent->GetWebContents()));
    bindings->AttachTo(agent);
    Frontends().push_back(web_contents()->GetWeakPtr());
    // The line the context menu guard greps for.
    LOG(INFO) << "domicile: DevTools is attached in a <webview>.";
  }

 private:
  friend class content::WebContentsUserData<DevToolsFrontendWatcher>;

  // A pointer, as WebContentsUserData::CreateForWebContents hands it over.
  explicit DevToolsFrontendWatcher(content::WebContents* guest)
      : content::WebContentsObserver(guest),
        content::WebContentsUserData<DevToolsFrontendWatcher>(*guest) {}

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(DevToolsFrontendWatcher);

}  // namespace

void OpenDevTools(content::RenderFrameHost& frame,
                  std::optional<gfx::Point> root_point) {
  content::WebContents* page =
      content::WebContents::FromRenderFrameHost(&frame);
  scoped_refptr<content::DevToolsAgentHost> agent =
      content::DevToolsAgentHost::GetOrCreateFor(page);
  // Before the window, as DevToolsWindow::InspectElement does. The agent keeps
  // the element for the front end that attaches later.
  if (root_point.has_value()) {
    agent->InspectElement(&frame, root_point->x(), root_point->y());
  }

  content::WebContents* open = FrontendFor(*agent);
  if (open != nullptr) {
    GuestOf(open).RequestFocus();
    return;
  }
  Waiting().push_back(std::move(agent));
  LOG(INFO) << "domicile: a <webview>'s page asked for DevTools; opening a "
               "browser window for it.";
  GuestOf(page).RequestWindow(FrontendURL());
}

void WatchForDevTools(content::WebContents& guest) {
  DevToolsFrontendWatcher::CreateForWebContents(&guest);
}

}  // namespace domicile
