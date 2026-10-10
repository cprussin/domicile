// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_browser_windows.h"

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/observer_list.h"
#include "base/observer_list_types.h"
#include "base/scoped_observation.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/supports_user_data.h"
#include "base/task/sequenced_task_runner.h"
#include "chrome/browser/domicile/domicile_tab_helpers.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "chrome/browser/ui/browser_window/public/browser_collection.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "components/domicile/browser/web_view_guest.h"
#include "components/domicile/common/domicile_scheme.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/document_service.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "url/gurl.h"

namespace domicile {
namespace {

constexpr char kWindowsUserDataKey[] = "domicile_browser_windows";

// Returns the shell's WebContents in `context`, or null when it has none.
//
// Matches by scheme, as the command socket does: the shell is the page served
// over domicile://, and a guest has no window of its own. Creation order keeps
// the result independent of which window the user touched last.
content::WebContents* ShellContentsIn(content::BrowserContext* context) {
  content::WebContents* shell = nullptr;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [&shell, context](BrowserWindowInterface* browser) {
        tabs::TabInterface* tab = browser->GetActiveTabInterface();
        if (tab != nullptr &&
            (context == nullptr ||
             tab->GetContents()->GetBrowserContext() == context) &&
            tab->GetContents()->GetLastCommittedURL().SchemeIs(
                kDomicileScheme)) {
          shell = tab->GetContents();
          return false;
        }
        return true;
      },
      BrowserCollection::Order::kCreation);
  return shell;
}

// One profile's browser windows, held as profile user data like the desk's
// window.
//
// Emptied on OnProfileWillBeDestroyed, not with the user data. Each window is
// a tab of the desk window and must not outlive it, and SupportsUserData's
// destruction order does not guarantee that.
class DeskWindows final : public base::SupportsUserData::Data,
                          public ProfileObserver {
 public:
  // A shell document listening.
  class Observer : public base::CheckedObserver {
   public:
    virtual void OnWindowsChanged() = 0;
  };

  // Returns `profile`'s windows, creating them on first use.
  static DeskWindows& For(Profile* profile) {
    if (auto* windows = static_cast<DeskWindows*>(
            profile->GetUserData(kWindowsUserDataKey))) {
      return *windows;
    }
    auto made = std::make_unique<DeskWindows>(profile);
    DeskWindows& windows = *made;
    profile->SetUserData(kWindowsUserDataKey, std::move(made));
    return windows;
  }

  explicit DeskWindows(Profile* profile) : profile_(profile) {
    profile_observation_.Observe(profile);
  }
  DeskWindows(const DeskWindows&) = delete;
  DeskWindows& operator=(const DeskWindows&) = delete;
  ~DeskWindows() override = default;

  // Opens a window at `url` as a tab of the desk's own window, or a private
  // window in the off-the-record profile. Returns false and opens nothing
  // when the profile has no shell to own it.
  bool Open(const GURL& url, bool private_browsing) {
    return Make(url, /*popup_window=*/std::nullopt, 0, 0, private_browsing,
                /*app=*/false);
  }

  // Opens an app window at `url`: a window of the desk's own window that the
  // shell draws without an address bar. Its page's new windows are browser
  // windows, as a link out of a Chrome app opens in the browser.
  bool OpenApp(const GURL& url) {
    return Make(url, /*popup_window=*/std::nullopt, 0, 0,
                /*private_browsing=*/false, /*app=*/true);
  }

  // Opens a window at `url` as popup window `window_id`'s one tab.
  bool OpenPopupWindow(int window_id, const GURL& url, int width, int height) {
    return Make(url, window_id, width, height, /*private_browsing=*/false,
                /*app=*/false);
  }

  // The off-the-record profile private windows live in, made on first use.
  // Watched, so its windows close before it is destroyed.
  Profile& PrivateProfile() {
    Profile* otr = profile_->GetPrimaryOTRProfile(/*create_if_needed=*/true);
    if (!private_observation_.IsObserving()) {
      private_observation_.Observe(otr);
    }
    return *otr;
  }

  // Closes window `id`. An unknown id is a close that raced another.
  void Close(const std::string& id) {
    auto found = std::ranges::find(windows_, id, &Window::id);
    if (found == windows_.end()) {
      LOG(WARNING) << "domicile: asked to close browser window " << id
                   << ", which is not open.";
      return;
    }
    // Remove from the list now and destroy later. Close runs inside the
    // window's own WebContents (window.close(), tabs.remove), and destroying a
    // WebContents under its own call stack is a use-after-free.
    closing_.push_back(std::move(found->guest));
    windows_.erase(found);
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(&DeskWindows::Reap, weak_factory_.GetWeakPtr()));
    LOG(INFO) << "domicile: closed browser window " << id << ".";
    Changed();
  }

  WebViewGuest* Find(const std::string& id) {
    auto found = std::ranges::find(windows_, id, &Window::id);
    return found == windows_.end() ? nullptr : found->guest.get();
  }

  // The whole list, as sent to the shell.
  std::vector<mojom::BrowserWindowPtr> List() const {
    std::vector<mojom::BrowserWindowPtr> list;
    for (const Window& window : windows_) {
      content::WebContents& contents = window.guest->contents();
      content::NavigationEntry* entry =
          contents.GetController().GetVisibleEntry();
      list.push_back(mojom::BrowserWindow::New(
          window.id, entry == nullptr ? GURL() : entry->GetVirtualURL(),
          base::UTF16ToUTF8(contents.GetTitle()),
          window.guest->popup_window().value_or(0), window.width,
          window.height, contents.GetBrowserContext()->IsOffTheRecord(),
          window.app));
    }
    return list;
  }

  void AddObserver(Observer* observer) { observers_.AddObserver(observer); }
  void RemoveObserver(Observer* observer) {
    observers_.RemoveObserver(observer);
  }

 private:
  // Reports a change to a page's address or title.
  class Watch final : public content::WebContentsObserver {
   public:
    Watch(content::WebContents& contents, base::RepeatingClosure changed)
        : WebContentsObserver(&contents), changed_(std::move(changed)) {}

    void TitleWasSet(content::NavigationEntry* entry) override {
      changed_.Run();
    }
    void DidFinishNavigation(content::NavigationHandle* navigation) override {
      if (navigation->IsInPrimaryMainFrame()) {
        changed_.Run();
      }
    }

   private:
    base::RepeatingClosure changed_;
  };

  struct Window {
    std::string id;
    std::unique_ptr<WebViewGuest> guest;
    std::unique_ptr<Watch> watch;
    int width = 0;
    int height = 0;
    bool app = false;
  };

  bool Make(const GURL& url,
            std::optional<int> popup_window,
            int width,
            int height,
            bool private_browsing,
            bool app) {
    // The shell owns every guest, browser windows included: content's guest
    // machinery reads the owner's WebContents when making a guest. A desk with
    // no shell has nothing to draw a window in anyway.
    content::WebContents* shell = ShellContentsIn(profile_);
    if (shell == nullptr) {
      LOG(WARNING) << "domicile: no shell to open a browser window at "
                   << url.possibly_invalid_spec() << " in.";
      return false;
    }
    const std::string id = base::NumberToString(next_id_++);
    std::unique_ptr<WebViewGuest> guest =
        WebViewGuest::MakeWindow(*shell, id, popup_window, private_browsing,
                                 base::BindRepeating(&AttachTabHelpers));
    // `windows_` owns `guest` and the watch from here.
    auto watch = std::make_unique<Watch>(
        guest->contents(),
        base::BindRepeating(&DeskWindows::Changed, base::Unretained(this)));
    guest->Navigate(url);
    windows_.push_back(
        Window{id, std::move(guest), std::move(watch), width, height, app});
    Changed();
    return true;
  }

  // Destroys closed windows' pages once none of their frames are on the stack.
  void Reap() { closing_.clear(); }

  void Changed() {
    for (Observer& observer : observers_) {
      observer.OnWindowsChanged();
    }
  }

  // ProfileObserver:
  void OnProfileWillBeDestroyed(Profile* profile) override {
    if (profile->IsOffTheRecord()) {
      // Only the private windows, which would otherwise outlive their
      // profile.
      private_observation_.Reset();
      std::erase_if(windows_, [](const Window& window) {
        return window.guest->contents().GetBrowserContext()->IsOffTheRecord();
      });
      std::erase_if(closing_, [](const std::unique_ptr<WebViewGuest>& guest) {
        return guest->contents().GetBrowserContext()->IsOffTheRecord();
      });
      Changed();
      return;
    }
    profile_observation_.Reset();
    private_observation_.Reset();
    windows_.clear();
    closing_.clear();
  }

  const raw_ptr<Profile> profile_;

  // In open order, which is the order sent to the shell.
  std::vector<Window> windows_;
  int next_id_ = 1;

  // Closed and awaiting Reap. Held here, not in a DeleteSoon, so a profile
  // destroyed first takes them with it, before its desk's window.
  std::vector<std::unique_ptr<WebViewGuest>> closing_;

  base::ObserverList<Observer> observers_;
  base::ScopedObservation<Profile, ProfileObserver> profile_observation_{this};
  // The off-the-record profile, once PrivateProfile made it.
  base::ScopedObservation<Profile, ProfileObserver> private_observation_{this};

  base::WeakPtrFactory<DeskWindows> weak_factory_{this};
};

// WebViewGuest's host. Routes each call to the desk of the guest's profile,
// which for a private guest is its original profile's.
class Host final : public BrowserWindowHost {
 public:
  // A private page's new window is private too.
  void Open(content::BrowserContext& context, const GURL& url) override {
    Windows(context).Open(url, context.IsOffTheRecord());
  }

  void OpenPopupWindow(content::BrowserContext& context,
                       int window_id,
                       const GURL& url,
                       int width,
                       int height) override {
    Windows(context).OpenPopupWindow(window_id, url, width, height);
  }

  void Close(content::BrowserContext& context, const std::string& id) override {
    Windows(context).Close(id);
  }

  WebViewGuest* Find(content::BrowserContext& context,
                     const std::string& id) override {
    return Windows(context).Find(id);
  }

  content::BrowserContext& PrivateContext(
      content::BrowserContext& context) override {
    return Windows(context).PrivateProfile();
  }

 private:
  static DeskWindows& Windows(content::BrowserContext& context) {
    return DeskWindows::For(
        Profile::FromBrowserContext(&context)->GetOriginalProfile());
  }
};

// The list for one shell document. A DocumentService like ExtensionTray, so a
// reloaded shell binds a new one and gets the list again.
class BrowserWindowsService final
    : public content::DocumentService<mojom::BrowserWindows>,
      public DeskWindows::Observer {
 public:
  BrowserWindowsService(content::RenderFrameHost& frame,
                        mojo::PendingReceiver<mojom::BrowserWindows> receiver)
      : DocumentService(frame, std::move(receiver)),
        windows_(&DeskWindows::For(
            Profile::FromBrowserContext(frame.GetBrowserContext()))) {
    windows_->AddObserver(this);
  }

  ~BrowserWindowsService() override { windows_->RemoveObserver(this); }

 private:
  // mojom::BrowserWindows:
  void SetClient(
      mojo::PendingRemote<mojom::BrowserWindowsClient> client) override {
    if (client_.is_bound()) {
      ReportBadMessageAndDeleteThis(
          "domicile: the browser windows have one client per document.");
      return;
    }
    client_.Bind(std::move(client));
    OnWindowsChanged();
  }

  void Open(const GURL& url, bool private_browsing) override {
    windows_->Open(url, private_browsing);
  }

  void Close(const std::string& id) override { windows_->Close(id); }

  // DeskWindows::Observer:
  void OnWindowsChanged() override {
    if (client_.is_bound()) {
      client_->WindowsChanged(windows_->List());
    }
  }

  // Owned by the profile, which outlives every document in it.
  const raw_ptr<DeskWindows> windows_;
  mojo::Remote<mojom::BrowserWindowsClient> client_;
};

}  // namespace

void StartBrowserWindows() {
  static base::NoDestructor<Host> host;
  WebViewGuest::SetBrowserWindowHost(host.get());
}

bool OpenBrowserWindow(const GURL& url, bool app) {
  content::WebContents* shell = ShellContentsIn(nullptr);
  if (shell == nullptr) {
    return false;
  }
  DeskWindows& windows =
      DeskWindows::For(Profile::FromBrowserContext(shell->GetBrowserContext()));
  return app ? windows.OpenApp(url)
             : windows.Open(url, /*private_browsing=*/false);
}

void BindBrowserWindows(content::RenderFrameHost* frame,
                        mojo::PendingReceiver<mojom::BrowserWindows> receiver) {
  // Owns itself and dies with the document, like every DocumentService.
  new BrowserWindowsService(*frame, std::move(receiver));
}

}  // namespace domicile
