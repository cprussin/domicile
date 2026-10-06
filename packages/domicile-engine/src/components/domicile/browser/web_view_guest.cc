// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/web_view_guest.h"

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <tuple>
#include <utility>

#include "base/check.h"
#include "base/files/file_enumerator.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/memory/ptr_util.h"
#include "base/no_destructor.h"
#include "base/notreached.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/supports_user_data.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "components/domicile/browser/context_menu.h"
#include "components/domicile/browser/file_choice.h"
#include "components/domicile/browser/placeholder_stage.h"
#include "components/domicile/browser/shortcut_registry.h"
#include "components/domicile/browser/web_view_url.h"
#include "components/security_state/content/content_utils.h"
#include "components/security_state/core/security_state.h"
#include "content/public/browser/document_service.h"
#include "content/public/browser/host_zoom_map.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/page.h"
#include "content/public/browser/page_navigator.h"
#include "content/public/browser/reload_type.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/render_view_host.h"
#include "content/public/browser/unowned_inner_web_contents_client.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/common/referrer.h"
#include "content/public/common/stop_find_action.h"
#include "content/public/common/url_constants.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"
#include "mojo/public/cpp/bindings/message.h"
#include "net/http/http_request_headers.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "third_party/blink/public/common/loader/network_utils.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "third_party/blink/public/mojom/choosers/file_chooser.mojom.h"
#include "third_party/blink/public/mojom/context_menu/context_menu.mojom.h"
#include "third_party/blink/public/mojom/favicon/favicon_url.mojom.h"
#include "third_party/blink/public/mojom/frame/find_in_page.mojom.h"
#include "ui/base/clipboard/clipboard_buffer.h"
#include "ui/base/clipboard/scoped_clipboard_writer.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
#include "ui/gfx/geometry/point_conversions.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/size.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/dom/dom_key.h"
#include "ui/events/keycodes/dom/keycode_converter.h"

namespace domicile {
namespace {

// Bad-message reason for a CreateGuest naming another document's frame.
constexpr char kNotItsOwnFrame[] =
    "domicile: a <webview> may only ask for a guest for its own frame.";

// Bad-message reason for a second waiting CreateGuest on one pipe.
constexpr char kOneGuest[] =
    "domicile: a <webview> may only ask for one guest.";

// The desk's browser windows. See SetBrowserWindowHost.
BrowserWindowHost* g_browser_window_host = nullptr;

BrowserWindowHost& Host() {
  // //chrome sets it in StartDesk, before any profile can bind anything. A
  // guest finding none means the fork never set it.
  CHECK(g_browser_window_host);
  return *g_browser_window_host;
}

// Storage for SetInspect's callback.
InspectCallback& InspectSlot() {
  static base::NoDestructor<InspectCallback> inspect;
  return *inspect;
}

// Opens DevTools. See SetInspect.
const InspectCallback& Inspector() {
  // //chrome sets it in StartDesk, with the window host.
  CHECK(!InspectSlot().is_null());
  return InspectSlot();
}

// Serves WebViewGuestHost for one document.
//
// A DocumentService because requests are scoped to the asking document: the
// placeholder must be its child, and a navigation ends its claim.
//
// Also a WebContentsObserver because CreateGuest (sent over the browser
// interface broker) can arrive before the placeholder frame or its
// about:blank commit (sent over the frame's channel). The request waits for
// both instead of being dropped. See PlaceholderStage::kCommitting.
class WebViewGuestHost final
    : public content::DocumentService<mojom::WebViewGuestHost>,
      public content::WebContentsObserver {
 public:
  WebViewGuestHost(content::RenderFrameHost& frame,
                   mojo::PendingReceiver<mojom::WebViewGuestHost> receiver,
                   GuestCreatedCallback created)
      : DocumentService(frame, std::move(receiver)),
        WebContentsObserver(content::WebContents::FromRenderFrameHost(&frame)),
        created_(std::move(created)) {}

 private:
  // A CreateGuest whose placeholder is not ready yet.
  //
  // Holds the bad-message callback. It can only be taken during dispatch, and
  // the parent check runs later, once the frame exists.
  struct WaitingRequest {
    blink::LocalFrameToken placeholder_frame;
    mojo::PendingReceiver<mojom::WebViewGuest> guest;
    mojo::PendingRemote<mojom::WebViewGuestClient> client;
    std::optional<std::string> window;
    bool extension_popup;
    mojo::ReportBadMessageCallback report_bad_message;
  };

  // mojom::WebViewGuestHost:
  void CreateGuest(const blink::LocalFrameToken& placeholder_frame,
                   mojo::PendingReceiver<mojom::WebViewGuest> guest,
                   mojo::PendingRemote<mojom::WebViewGuestClient> client,
                   const std::optional<std::string>& window,
                   bool extension_popup) override {
    content::RenderFrameHost* placeholder = FindPlaceholder(placeholder_frame);

    // A document may only claim a guest for its own child frame.
    //
    // Uses DocumentService's ReportBadMessageAndDeleteThis, as its header
    // asks, which resets the receiver before deleting.
    if (placeholder != nullptr &&
        placeholder->GetParent() != &render_frame_host()) {
      ReportBadMessageAndDeleteThis(kNotItsOwnFrame);
      return;
    }

    const GURL committed =
        placeholder == nullptr ? GURL() : placeholder->GetLastCommittedURL();
    switch (StageOf(placeholder != nullptr, committed)) {
      case PlaceholderStage::kAbsent:
      case PlaceholderStage::kCommitting:
        // At most one request waits per pipe; the element sends only one.
        if (waiting_.has_value()) {
          ReportBadMessageAndDeleteThis(kOneGuest);
          return;
        }
        // Distinguishes a waiting guest in logs.
        LOG(INFO) << "domicile: a <webview> asked for a guest before its frame "
                     "or its frame's first page arrived; waiting for it.";
        waiting_ = WaitingRequest{
            placeholder_frame, std::move(guest),
            std::move(client), window,
            extension_popup,   mojo::GetBadMessageCallback()};
        return;
      case PlaceholderStage::kReady:
        Give(*placeholder, std::move(guest), std::move(client), window,
             extension_popup);
        return;
    }
  }

  // content::WebContentsObserver:
  //
  // The retry is posted because this runs inside FrameTree::AddFrame, before
  // the frame is fully added.
  void RenderFrameCreated(content::RenderFrameHost* frame) override {
    RetryIfWaitingFor(*frame);
  }

  // Retries on the placeholder's about:blank commit. Posted because this runs
  // inside Navigator::DidNavigate.
  void DidFinishNavigation(
      content::NavigationHandle* navigation_handle) override {
    if (navigation_handle->HasCommitted()) {
      RetryIfWaitingFor(*navigation_handle->GetRenderFrameHost());
    }
  }

  // Runs the waiting request again, in a task, if `frame` is its placeholder.
  void RetryIfWaitingFor(content::RenderFrameHost& frame) {
    if (!waiting_.has_value() ||
        frame.GetFrameToken() != waiting_->placeholder_frame) {
      return;
    }
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(&WebViewGuestHost::CreateWaitingGuest,
                       weak_factory_.GetWeakPtr(), std::move(*waiting_)));
    waiting_.reset();
  }

  // The rest of CreateGuest, for a request that waited.
  void CreateWaitingGuest(WaitingRequest request) {
    content::RenderFrameHost* placeholder =
        FindPlaceholder(request.placeholder_frame);

    // The <webview> was removed meanwhile. This is a race, not a bad message,
    // so just drop the pipes.
    if (placeholder == nullptr) {
      LOG(WARNING) << "domicile: the frame a <webview> asked a guest for is "
                      "already gone.";
      return;
    }

    // Same check as CreateGuest, using the callback saved during dispatch.
    if (placeholder->GetParent() != &render_frame_host()) {
      std::move(request.report_bad_message).Run(kNotItsOwnFrame);
      ResetAndDeleteThis();
      return;
    }

    switch (StageOf(/*frame_exists=*/true,
                    placeholder->GetLastCommittedURL())) {
      case PlaceholderStage::kAbsent:
        NOTREACHED();
      case PlaceholderStage::kCommitting:
        // The frame exists but has not committed; wait for
        // DidFinishNavigation.
        if (waiting_.has_value()) {
          std::move(request.report_bad_message).Run(kOneGuest);
          ResetAndDeleteThis();
          return;
        }
        waiting_ = std::move(request);
        return;
      case PlaceholderStage::kReady:
        Give(*placeholder, std::move(request.guest), std::move(request.client),
             request.window, request.extension_popup);
        return;
    }
  }

  // Puts a page behind `placeholder`: the browser window `window` names, or a
  // new page owned by this document (an extension's action popup when
  // `extension_popup` is set).
  //
  // An unknown `window` is expected: it may close before the shell hears. The
  // pipes drop and a warning is logged.
  void Give(content::RenderFrameHost& placeholder,
            mojo::PendingReceiver<mojom::WebViewGuest> guest,
            mojo::PendingRemote<mojom::WebViewGuestClient> client,
            const std::optional<std::string>& window,
            bool extension_popup) {
    if (!window.has_value()) {
      WebViewGuest::CreateAndAttach(render_frame_host(), placeholder,
                                    std::move(guest), std::move(client),
                                    extension_popup, created_);
      return;
    }
    WebViewGuest* shown =
        Host().Find(*render_frame_host().GetBrowserContext(), *window);
    if (shown == nullptr) {
      LOG(WARNING) << "domicile: a <webview> named browser window \""
                   << *window << "\", which is not open; it shows nothing.";
      return;
    }
    shown->AttachToElement(render_frame_host(), placeholder, std::move(guest),
                           std::move(client));
  }

  // The frame `placeholder_frame` names, or null if the browser has none.
  //
  // The placeholder is never navigated, so it is always in the asking
  // document's process.
  content::RenderFrameHost* FindPlaceholder(
      const blink::LocalFrameToken& placeholder_frame) {
    return content::RenderFrameHost::FromFrameToken(
        content::GlobalRenderFrameHostToken(
            render_frame_host().GetProcess()->GetID(), placeholder_frame));
  }

  // Lives no longer than the element's pipe. See
  // HTMLWebViewElement::RequestGuest.
  std::optional<WaitingRequest> waiting_;

  // The embedder's helpers, for every guest this document makes.
  const GuestCreatedCallback created_;

  base::WeakPtrFactory<WebViewGuestHost> weak_factory_{this};
};

// Maps Chromium's security level to the wire enum.
//
// A switch with no default, not a cast, so an upstream renumbering or new
// level breaks the build. SECURITY_LEVEL_COUNT is the enum bound, listed only
// to keep the switch exhaustive.
mojom::WebViewSecurity AsWebViewSecurity(security_state::SecurityLevel level) {
  switch (level) {
    case security_state::NONE:
      return mojom::WebViewSecurity::kNeutral;
    case security_state::SECURE:
      return mojom::WebViewSecurity::kSecure;
    case security_state::WARNING:
      return mojom::WebViewSecurity::kWarning;
    case security_state::DANGEROUS:
      return mojom::WebViewSecurity::kDangerous;
    case security_state::SECURITY_LEVEL_COUNT:
      NOTREACHED();
  }
}

// How long a context menu edit waits for the page to regain focus: 25 tries
// 20 ms apart. See WebViewGuest::EditWhenFocused.
constexpr int kEditTries = 25;
constexpr base::TimeDelta kEditRetry = base::Milliseconds(20);

// User data key linking a guest's WebContents to it, for FromWebContents.
constexpr char kGuestUserDataKey[] = "domicile_web_view_guest";

// Holds a weak pointer because the WebContents does not own the guest.
class GuestLink : public base::SupportsUserData::Data {
 public:
  explicit GuestLink(base::WeakPtr<WebViewGuest> guest)
      : guest_(std::move(guest)) {}

  WebViewGuest* guest() const { return guest_.get(); }

 private:
  base::WeakPtr<WebViewGuest> guest_;
};

// Maps Blink's five modes to the picker's four. See WebViewFileChooserMode in
// the mojom. No default, so a new Blink mode breaks the build.
mojom::WebViewFileChooserMode AsWebViewFileChooserMode(
    blink::mojom::FileChooserParams::Mode mode) {
  switch (mode) {
    case blink::mojom::FileChooserParams::Mode::kOpen:
      return mojom::WebViewFileChooserMode::kOpen;
    case blink::mojom::FileChooserParams::Mode::kOpenMultiple:
      return mojom::WebViewFileChooserMode::kOpenMultiple;
    case blink::mojom::FileChooserParams::Mode::kUploadFolder:
    case blink::mojom::FileChooserParams::Mode::kOpenDirectory:
      return mojom::WebViewFileChooserMode::kOpenFolder;
    case blink::mojom::FileChooserParams::Mode::kSave:
      return mojom::WebViewFileChooserMode::kSave;
  }
}

// Resolves the shell's answer to absolute paths, or nothing if it does not fit
// `mode`. The element validates first, so a mismatch is a bad message.
std::optional<std::vector<base::FilePath>> ChosenPaths(
    mojom::WebViewFileChooserMode mode,
    const std::vector<std::string>& paths) {
  if (!IsAnswerFor(mode, paths.size())) {
    return std::nullopt;
  }
  const base::FilePath home = base::GetHomeDir();
  std::vector<base::FilePath> chosen;
  for (const std::string& path : paths) {
    std::optional<base::FilePath> resolved = ResolvedPath(home, path);
    if (!resolved.has_value()) {
      return std::nullopt;
    }
    chosen.push_back(*resolved);
  }
  return chosen;
}

constexpr char kNotAnAnswer[] =
    "domicile: a <webview> answered a file chooser with paths it was not "
    "asked for.";

std::vector<blink::mojom::FileChooserFileInfoPtr> AsFileInfos(
    const std::vector<base::FilePath>& paths) {
  std::vector<blink::mojom::FileChooserFileInfoPtr> files;
  for (const base::FilePath& path : paths) {
    files.push_back(blink::mojom::FileChooserFileInfo::NewNativeFile(
        blink::mojom::NativeFileInfo::New(path, std::u16string(),
                                          std::vector<std::u16string>())));
  }
  return files;
}

// Lists every file under `folder` for a folder upload. Blocking; run on the
// thread pool.
std::vector<base::FilePath> FilesUnder(const base::FilePath& folder) {
  std::vector<base::FilePath> files;
  base::FileEnumerator walk(folder, /*recursive=*/true,
                            base::FileEnumerator::FILES);
  for (base::FilePath file = walk.Next(); !file.empty(); file = walk.Next()) {
    files.push_back(file);
  }
  return files;
}

void FolderRead(scoped_refptr<content::FileSelectListener> listener,
                const base::FilePath& folder,
                std::vector<base::FilePath> files) {
  listener->FileSelected(AsFileInfos(files), folder,
                         blink::mojom::FileChooserParams::Mode::kUploadFolder);
}

// Passes the shell's answer for `<input type="file">` to content.
//
// A free function, not a method, because content requires every listener to
// be answered once, even after the guest is gone.
void FilesChosen(scoped_refptr<content::FileSelectListener> listener,
                 blink::mojom::FileChooserParams::Mode mode,
                 const std::optional<std::vector<std::string>>& paths) {
  if (!paths.has_value()) {
    listener->FileSelectionCanceled();
    return;
  }
  std::optional<std::vector<base::FilePath>> chosen =
      ChosenPaths(AsWebViewFileChooserMode(mode), *paths);
  if (!chosen.has_value()) {
    mojo::ReportBadMessage(kNotAnAnswer);
    listener->FileSelectionCanceled();
    return;
  }
  LOG(INFO) << "domicile: a <webview>'s file chooser was answered with "
            << chosen->size() << " path(s).";
  if (mode == blink::mojom::FileChooserParams::Mode::kUploadFolder) {
    const base::FilePath folder = chosen->front();
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, {base::MayBlock()}, base::BindOnce(&FilesUnder, folder),
        base::BindOnce(&FolderRead, std::move(listener), folder));
    return;
  }
  listener->FileSelected(AsFileInfos(*chosen), base::FilePath(), mode);
}

// Passes the shell's download location to //chrome.
void DownloadPathChosen(
    base::OnceCallback<void(std::optional<base::FilePath>)> chosen,
    const std::optional<std::vector<std::string>>& paths) {
  if (!paths.has_value()) {
    std::move(chosen).Run(std::nullopt);
    return;
  }
  std::optional<std::vector<base::FilePath>> resolved =
      ChosenPaths(mojom::WebViewFileChooserMode::kSave, *paths);
  if (!resolved.has_value()) {
    mojo::ReportBadMessage(kNotAnAnswer);
    std::move(chosen).Run(std::nullopt);
    return;
  }
  LOG(INFO) << "domicile: a <webview>'s download was given somewhere to go.";
  std::move(chosen).Run(resolved->front());
}

// Passes the shell's answer back to a browser dialog. See
// WebViewGuest::ChooseFiles.
void DialogFilesChosen(
    mojom::WebViewFileChooserMode mode,
    base::OnceCallback<void(std::optional<std::vector<base::FilePath>>)> chosen,
    const std::optional<std::vector<std::string>>& paths) {
  if (!paths.has_value()) {
    std::move(chosen).Run(std::nullopt);
    return;
  }
  std::optional<std::vector<base::FilePath>> resolved =
      ChosenPaths(mode, *paths);
  if (!resolved.has_value()) {
    mojo::ReportBadMessage(kNotAnAnswer);
  }
  std::move(chosen).Run(std::move(resolved));
}

}  // namespace

// static
void WebViewGuest::CreateAndAttach(
    content::RenderFrameHost& owner,
    content::RenderFrameHost& placeholder,
    mojo::PendingReceiver<mojom::WebViewGuest> receiver,
    mojo::PendingRemote<mojom::WebViewGuestClient> client,
    bool extension_popup,
    const GuestCreatedCallback& created) {
  std::unique_ptr<WebViewGuest> guest = base::WrapUnique(new WebViewGuest(
      owner, std::move(receiver), std::move(client), extension_popup));
  guest->owned_guest_contents_ = guest->MakeContents(
      owner.GetBrowserContext(), /*initially_hidden=*/false, created);


  // Asynchronous: beforeunload handlers must run first, and a cross-process
  // placeholder is replaced. The callback gets the frame that is safe to
  // swap, which may differ from `placeholder`.
  placeholder.PrepareForInnerWebContentsAttach(
      base::BindOnce(&WebViewGuest::Attach, std::move(guest)));
}

// static
void WebViewGuest::Attach(std::unique_ptr<WebViewGuest> guest,
                          content::RenderFrameHost* outer_contents_frame) {
  // Null if beforeunload refused or the frame was detached. Returning destroys
  // `guest` and its WebContents.
  if (outer_contents_frame == nullptr) {
    return;
  }

  // Use the frame's WebContents, which AttachInnerWebContents CHECKs. The
  // owner document may have navigated during the attach.
  content::WebContents* owner =
      content::WebContents::FromRenderFrameHost(outer_contents_frame);
  CHECK(owner);

  std::unique_ptr<content::WebContents> contents =
      std::move(guest->owned_guest_contents_);

  // As in GuestViewBase, the outer WebContents takes the inner one and this
  // object deletes itself in WebContentsDestroyed.
  guest->self_owned_ = true;
  guest.release();

  // `is_full_page` true would focus the guest and CHECK that the outer
  // WebContents has only one inner one, which fails with two browser windows.
  // The shell moves focus itself with `view.focus()`.
  owner->AttachInnerWebContents(std::move(contents), outer_contents_frame,
                                /*is_full_page=*/false);

  // Helps diagnose a blank <webview>. engine-diagnostics.sh greps for the
  // `domicile:` prefix.
  LOG(INFO) << "domicile: attached a guest to a <webview>.";
}

// static
std::unique_ptr<WebViewGuest> WebViewGuest::MakeWindow(
    content::WebContents& shell,
    const std::string& window_id,
    std::optional<int> popup_window,
    const GuestCreatedCallback& created) {
  std::unique_ptr<WebViewGuest> guest =
      base::WrapUnique(new WebViewGuest(shell, window_id, popup_window));
  // Hidden (and throttled) like a background tab until AttachWindowTo shows
  // it.
  guest->owned_guest_contents_ = guest->MakeContents(
      shell.GetBrowserContext(), /*initially_hidden=*/true, created);
  LOG(INFO) << "domicile: opened browser window " << window_id << ".";
  return guest;
}

std::unique_ptr<content::WebContents> WebViewGuest::MakeContents(
    content::BrowserContext* context,
    bool initially_hidden,
    const GuestCreatedCallback& created) {
  // `guest_delegate` makes this a guest. Content asks it for the owner during
  // construction, so the owner is set in this object's constructor.
  //
  // No SiteInstance or StoragePartitionConfig: the guest uses the default
  // partition with the user's cookies. See the class comment.
  content::WebContents::CreateParams params(context);
  params.guest_delegate = this;
  params.initially_hidden = initially_hidden;
  std::unique_ptr<content::WebContents> contents =
      content::WebContents::Create(params);

  guest_contents_ = contents.get();
  contents->SetUserData(
      kGuestUserDataKey,
      std::make_unique<GuestLink>(weak_factory_.GetWeakPtr()));
  Observe(guest_contents_);
  guest_contents_->SetDelegate(this);

  // After SetDelegate, which some helpers need, and before the first
  // navigation, which some record.
  created.Run(*guest_contents_);

  // Unretained is safe: the subscription is a member, reset in
  // WebContentsDestroyed.
  zoom_subscription_ =
      content::HostZoomMap::GetForWebContents(guest_contents_)
          ->AddZoomLevelChangedCallback(base::BindRepeating(
              [](WebViewGuest* guest,
                 const content::HostZoomMap::ZoomLevelChange& change) {
                guest->ReportZoom();
              },
              base::Unretained(this)));
  return contents;
}

void WebViewGuest::AttachToElement(
    content::RenderFrameHost& owner,
    content::RenderFrameHost& placeholder,
    mojo::PendingReceiver<mojom::WebViewGuest> receiver,
    mojo::PendingRemote<mojom::WebViewGuestClient> client) {
  CHECK(!window_id_.empty());

  // A window shows in one frame at a time; a second element shows nothing.
  if (attaching_ || guest_contents_->GetOuterWebContents() != nullptr) {
    LOG(WARNING) << "domicile: a <webview> named browser window " << window_id_
                 << ", which another <webview> is already showing; it shows "
                    "nothing.";
    return;
  }

  // Replace any binding from an element that has gone.
  owner_rfh_id_ = owner.GetGlobalId();
  receiver_.reset();
  receiver_.Bind(std::move(receiver));
  client_.reset();
  client_.Bind(std::move(client));
  client_.set_disconnect_handler(
      base::BindOnce(&WebViewGuest::ElementGone, base::Unretained(this)));

  attaching_ = true;
  // As in CreateAndAttach, the given frame may not be safe to swap.
  placeholder.PrepareForInnerWebContentsAttach(base::BindOnce(
      &WebViewGuest::AttachWindowTo, weak_factory_.GetWeakPtr()));
}

void WebViewGuest::AttachWindowTo(
    content::RenderFrameHost* outer_contents_frame) {
  attaching_ = false;
  // Refused, as in Attach. The window survives and an element can ask again.
  if (outer_contents_frame == nullptr) {
    ElementGone();
    return;
  }

  content::WebContents* owner =
      content::WebContents::FromRenderFrameHost(outer_contents_frame);
  CHECK(owner);
  owner_contents_ = owner->GetWeakPtr();

  // Unowned, so when the frame goes content detaches the page and keeps it
  // alive (WebContentsTreeNode::OnFrameTreeNodeDestroyed). The fork's patch
  // for kAttachUnownedInnerWebContents provides this API.
  owner->AttachUnownedInnerWebContents(
      content::UnownedInnerWebContentsClient::GetPassKey(), guest_contents_,
      outer_contents_frame);
  guest_contents_->WasShown();

  // Guards read this line to tell a reshown window from a recreated page.
  // engine-diagnostics.sh greps for the `domicile:` prefix.
  LOG(INFO) << "domicile: attached browser window " << window_id_
            << " to a <webview>.";

  ReportEverything();
}

void WebViewGuest::ElementGone() {
  receiver_.reset();
  Unclient();
  // The find bar belonged to the element.
  find_text_.clear();
  guest_contents_->WasHidden();
  LOG(INFO) << "domicile: browser window " << window_id_
            << " is shown by no <webview>.";
}

void WebViewGuest::Unclient() {
  client_.reset();
  std::ignore = client_.BindNewPipeAndPassReceiver();
}

void WebViewGuest::ReportEverything() {
  reported_can_go_back_ = false;
  reported_can_go_forward_ = false;
  reported_loading_ = false;
  reported_url_ = GURL();
  reported_security_ = mojom::WebViewSecurity::kNeutral;
  reported_find_matches_ = 0;
  reported_find_active_match_ = 0;

  ReportHistory();
  ReportPage();
  ReportLoading(guest_contents_->ShouldShowLoadingUI());
  // Bypasses ReportZoom, which would also notify chrome.tabs of an unchanged
  // zoom.
  if (!blink::ZoomValuesEqual(reported_zoom_, 1.0)) {
    client_->ZoomChanged(reported_zoom_);
  }
  if (!reported_favicon_.is_empty()) {
    client_->FaviconChanged(reported_favicon_);
  }
  if (content_size_.has_value()) {
    client_->ContentSizeChanged(content_size_->width(),
                                content_size_->height());
  }
}

WebViewGuest::WebViewGuest(
    content::RenderFrameHost& owner,
    mojo::PendingReceiver<mojom::WebViewGuest> receiver,
    mojo::PendingRemote<mojom::WebViewGuestClient> client,
    bool extension_popup)
    : owner_rfh_id_(owner.GetGlobalId()),
      extension_popup_(extension_popup),
      receiver_(this, std::move(receiver)),
      client_(std::move(client)) {}

WebViewGuest::WebViewGuest(content::WebContents& shell,
                           const std::string& window_id,
                           std::optional<int> popup_window)
    : owner_rfh_id_(shell.GetPrimaryMainFrame()->GetGlobalId()),
      popup_window_(popup_window),
      extension_popup_(false),
      window_id_(window_id),
      owner_contents_(shell.GetWeakPtr()),
      receiver_(this) {
  // No element yet; see Unclient.
  Unclient();
}

// Destroys a browser window's WebContents first, while members still exist for
// content's teardown callbacks. Member order would destroy it last.
WebViewGuest::~WebViewGuest() {
  owned_guest_contents_.reset();
}

// static
void WebViewGuest::SetBrowserWindowHost(BrowserWindowHost* host) {
  CHECK(!g_browser_window_host);
  g_browser_window_host = host;
}

// static
void WebViewGuest::SetInspect(InspectCallback inspect) {
  CHECK(InspectSlot().is_null());
  InspectSlot() = std::move(inspect);
}

// static
WebViewGuest* WebViewGuest::FromWebContents(content::WebContents* contents) {
  const auto* link =
      static_cast<GuestLink*>(contents->GetUserData(kGuestUserDataKey));
  return link == nullptr ? nullptr : link->guest();
}

void WebViewGuest::ChooseDownloadPath(
    const base::FilePath& suggested_path,
    base::OnceCallback<void(std::optional<base::FilePath>)> chosen) {
  // Logged before asking; the download guard greps for it.
  LOG(INFO) << "domicile: a <webview>'s download asked the shell where to go.";

  // No accept list: a download may be saved under any name.
  //
  // Wrapped so a pipe closing unanswered still answers //chrome, which holds
  // the download until then.
  client_->FileChooserRequested(
      mojom::WebViewFileChooserMode::kSave, {},
      suggested_path.BaseName().AsUTF8Unsafe(),
      base::GetHomeDir().AsUTF8Unsafe(),
      mojo::WrapCallbackWithDefaultInvokeIfNotRun(
          base::BindOnce(&DownloadPathChosen, std::move(chosen)),
          std::nullopt));
}

void WebViewGuest::ChooseFiles(
    mojom::WebViewFileChooserMode mode,
    const std::vector<std::string>& accept,
    const base::FilePath& suggested_path,
    base::OnceCallback<void(std::optional<std::vector<base::FilePath>>)>
        chosen) {
  // Wrapped, as in ChooseDownloadPath: the dialog waits for an answer.
  client_->FileChooserRequested(
      mode, accept, suggested_path.BaseName().AsUTF8Unsafe(),
      base::GetHomeDir().AsUTF8Unsafe(),
      mojo::WrapCallbackWithDefaultInvokeIfNotRun(
          base::BindOnce(&DialogFilesChosen, mode, std::move(chosen)),
          std::nullopt));
}

void WebViewGuest::Navigate(const GURL& url) {
  // This object is destroyed with the guest's WebContents, so guest_contents_
  // is never null here.
  // Navigating before the attach finishes is safe: content brings the guest
  // up during the attach.
  CHECK(guest_contents_);

  // The URL often comes from a page (`target="_blank"`) or an extension
  // (`tabs.update`), and a guest on domicile:// would give it shell access.
  // Show about:blank#blocked, as content does, so the address bar explains.
  const bool may_show = MayShowInWebView(url);
  if (!may_show) {
    LOG(WARNING) << "domicile: a <webview> may not show "
                 << url.possibly_invalid_spec() << "; it is blocked.";
  }
  content::NavigationController::LoadURLParams params(
      may_show ? url : GURL(content::kBlockedURL));
  params.transition_type = ui::PAGE_TRANSITION_AUTO_TOPLEVEL;
  guest_contents_->GetController().LoadURLWithParams(params);
}

void WebViewGuest::GoBack() {
  CHECK(guest_contents_);

  // GoBack does nothing with no history, which is a normal case, not a bad
  // message.
  guest_contents_->GetController().GoBack();
}

void WebViewGuest::GoForward() {
  CHECK(guest_contents_);
  guest_contents_->GetController().GoForward();
}

void WebViewGuest::Stop() {
  CHECK(guest_contents_);
  // NavigationController has no Stop; the WebContents cancels the load.
  guest_contents_->Stop();
}

void WebViewGuest::Reload() {
  CHECK(guest_contents_);
  // With `check_for_repost`, reloading a POST result calls content's no-op
  // ShowRepostFormWarningDialog, so it does nothing instead of reposting
  // without asking.
  guest_contents_->GetController().Reload(content::ReloadType::NORMAL,
                                          /*check_for_repost=*/true);
}

void WebViewGuest::SetZoom(double factor) {
  CHECK(guest_contents_);

  // The element throws a RangeError first, so this is a bad message.
  if (!(factor >= blink::kMinimumBrowserZoomFactor &&
        factor <= blink::kMaximumBrowserZoomFactor)) {
    receiver_.ReportBadMessage(
        "domicile: a <webview> asked for a zoom outside the browser's range.");
    return;
  }
  ZoomTo(factor);
}

void WebViewGuest::Find(const std::string& text, bool forward) {
  CHECK(guest_contents_);

  const std::u16string search = base::UTF8ToUTF16(text);
  // The element sends StopFinding instead, and content NOTREACHEDs on empty
  // text.
  if (search.empty()) {
    receiver_.ReportBadMessage(
        "domicile: a <webview> asked to find nothing in its page.");
    return;
  }

  // As in Chrome's find bar: the same text moves to the next match, new text
  // starts over.
  const bool new_session = search != find_text_;
  if (new_session) {
    find_text_ = search;
  }

  auto options = blink::mojom::FindOptions::New();
  options->forward = forward;
  options->new_session = new_session;
  // Keep content's delay, which debounces typing in a find bar.
  guest_contents_->Find(find_text_, std::move(options), /*skip_delay=*/false,
                        [this, new_session](int request_id) {
                          if (new_session) {
                            find_session_id_ = request_id;
                          }
                        });
}

void WebViewGuest::StopFinding(bool keep_selection) {
  CHECK(guest_contents_);
  guest_contents_->StopFinding(keep_selection
                                   ? content::STOP_FIND_ACTION_KEEP_SELECTION
                                   : content::STOP_FIND_ACTION_CLEAR_SELECTION);
  EndFind();
}

double WebViewGuest::GetZoomFactor() const {
  CHECK(guest_contents_);
  return blink::ZoomLevelToZoomFactor(
      content::HostZoomMap::GetZoomLevel(guest_contents_));
}

void WebViewGuest::ZoomTo(double factor) {
  CHECK(guest_contents_);
  CHECK(factor >= blink::kMinimumBrowserZoomFactor &&
        factor <= blink::kMaximumBrowserZoomFactor);

  // Sets the site's zoom, not this window's, as Chrome does.
  content::HostZoomMap::SetZoomLevel(guest_contents_,
                                     blink::ZoomFactorToZoomLevel(factor));

  // The subscription already reported this for pages with a host. This covers
  // error pages and uncommitted guests; ReportZoom skips duplicates.
  ReportZoom();
}

content::WebContents* WebViewGuest::GetOwnerWebContents() {
  // A browser window's owner is the shell's WebContents. See MakeWindow.
  if (!window_id_.empty()) {
    return owner_contents_.get();
  }
  content::RenderFrameHost* owner =
      content::RenderFrameHost::FromID(owner_rfh_id_);
  return owner ? content::WebContents::FromRenderFrameHost(owner) : nullptr;
}

content::RenderFrameHost* WebViewGuest::GetProspectiveOuterDocument() {
  // The shell's current document, which a reload replaces.
  if (!window_id_.empty()) {
    return owner_contents_ ? owner_contents_->GetPrimaryMainFrame() : nullptr;
  }
  return content::RenderFrameHost::FromID(owner_rfh_id_);
}

base::WeakPtr<content::BrowserPluginGuestDelegate>
WebViewGuest::GetGuestDelegateWeakPtr() {
  return weak_factory_.GetWeakPtr();
}

content::KeyboardEventProcessingResult WebViewGuest::PreHandleKeyboardEvent(
    content::WebContents* source,
    const input::NativeWebKeyboardEvent& event) {
  const int modifiers = event.GetModifiers();
  const Modifiers held{
      (modifiers & blink::WebInputEvent::kAltKey) != 0,
      (modifiers & blink::WebInputEvent::kControlKey) != 0,
      (modifiers & blink::WebInputEvent::kShiftKey) != 0,
      (modifiers & blink::WebInputEvent::kMetaKey) != 0,
  };

  // Every event, including releases: the shell tracks modifier state (Alt to
  // drag, Shift to resize). The registry drops unchanged states. Done before
  // matching so a chord's own modifiers are still reported.
  ShortcutRegistry::Get().SetModifiers(held);

  // Chords match on the first press only: no releases or auto-repeats.
  const bool pressed =
      event.GetType() == blink::WebInputEvent::Type::kRawKeyDown ||
      event.GetType() == blink::WebInputEvent::Type::kKeyDown;
  if (!pressed || (modifiers & blink::WebInputEvent::kIsAutoRepeat) != 0) {
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }

  // Chords are claimed in evdev codes. Zero means no evdev code, which no
  // chord can name.
  const int evdev = ui::KeycodeConverter::DomCodeToEvdevCode(
      static_cast<ui::DomCode>(event.dom_code));
  if (evdev == 0) {
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }

  // A matched chord is HANDLED so the page never sees it and cannot override a
  // desktop shortcut.
  //
  // Delivered only to the page containing this `<webview>`. Each monitor has
  // its own page, so broadcasting would run the chord once per monitor.
  return ShortcutRegistry::Get().Press(
             Chord{static_cast<uint32_t>(evdev), held.alt, held.ctrl,
                   held.shift, held.meta},
             Page{owner_rfh_id_.child_id.value(),
                  owner_rfh_id_.frame_routing_id})
             ? content::KeyboardEventProcessingResult::HANDLED
             : content::KeyboardEventProcessingResult::NOT_HANDLED;
}

bool WebViewGuest::HandleKeyboardEvent(
    content::WebContents* source,
    const input::NativeWebKeyboardEvent& event) {
  const int modifiers = event.GetModifiers();

  // Includes auto-repeats (e.g. holding Ctrl+Plus zooms repeatedly); the event
  // carries `repeat` so the shell can tell them apart.
  const bool pressed =
      event.GetType() == blink::WebInputEvent::Type::kRawKeyDown ||
      event.GetType() == blink::WebInputEvent::Type::kKeyDown;
  const bool chord =
      (modifiers & (blink::WebInputEvent::kAltKey |
                    blink::WebInputEvent::kControlKey |
                    blink::WebInputEvent::kMetaKey)) != 0;

  if (pressed && chord) {
    client_->UnhandledKeyDown(
        ui::KeycodeConverter::DomKeyToKeyString(ui::DomKey(event.dom_key)),
        ui::KeycodeConverter::DomCodeToCodeString(
            static_cast<ui::DomCode>(event.dom_code)),
        (modifiers & blink::WebInputEvent::kAltKey) != 0,
        (modifiers & blink::WebInputEvent::kControlKey) != 0,
        (modifiers & blink::WebInputEvent::kShiftKey) != 0,
        (modifiers & blink::WebInputEvent::kMetaKey) != 0,
        (modifiers & blink::WebInputEvent::kIsAutoRepeat) != 0);
  }
  return false;
}

void WebViewGuest::ContentsZoomChange(bool zoom_in) {
  client_->ZoomRequested(zoom_in);
}

bool WebViewGuest::HandleContextMenu(
    content::RenderFrameHost& render_frame_host,
    const content::ContextMenuParams& params) {
  CHECK(guest_contents_);
  // The guest's main frame view is the element's box. It exists because a
  // frame in this page just asked for a menu.
  content::RenderWidgetHostView* page =
      guest_contents_->GetPrimaryMainFrame()->GetView();
  CHECK(page);
  const gfx::Point in_page =
      gfx::ToRoundedPoint(page->TransformRootPointToViewCoordSpace(
          gfx::PointF(params.x, params.y)));

  context_menu_id_ += 1;
  context_menu_frame_ = render_frame_host.GetGlobalId();
  context_menu_params_ = params;

  // The context menu guard greps for this line.
  LOG(INFO) << "domicile: a <webview>'s page asked for a context menu; "
               "asking the shell to draw it.";
  client_->ContextMenuRequested(
      AsWebViewContextMenu(context_menu_id_, params, in_page));
  return true;
}

void WebViewGuest::RunContextMenuAction(
    int32_t menu,
    mojom::WebViewContextMenuAction action) {
  CHECK(guest_contents_);

  // The element only sends ids it received, so this is a bad message.
  if (menu <= 0 || menu > context_menu_id_) {
    receiver_.ReportBadMessage(
        "domicile: a <webview> answered a context menu it was never sent.");
    return;
  }
  // A race: a newer menu was sent before the shell acted.
  if (menu != context_menu_id_) {
    LOG(INFO) << "domicile: a <webview>'s context menu was replaced before "
                 "the shell acted on it; dropping the action.";
    return;
  }
  const content::ContextMenuParams& params = *context_menu_params_;
  if (!Offers(params, action)) {
    receiver_.ReportBadMessage(
        "domicile: a <webview> asked a context menu for an action it does not "
        "offer.");
    return;
  }
  // The frame navigated away after the menu was drawn.
  content::RenderFrameHost* frame =
      content::RenderFrameHost::FromID(context_menu_frame_);
  if (frame == nullptr) {
    LOG(INFO) << "domicile: the page a <webview>'s context menu was for is "
                 "gone; dropping the action.";
    return;
  }

  LOG(INFO) << "domicile: a <webview>'s context menu ran action "
            << static_cast<int>(action) << ".";
  switch (action) {
    case mojom::WebViewContextMenuAction::kUndo:
      EditWhenFocused(&content::WebContents::Undo, kEditTries);
      return;
    case mojom::WebViewContextMenuAction::kRedo:
      EditWhenFocused(&content::WebContents::Redo, kEditTries);
      return;
    case mojom::WebViewContextMenuAction::kCut:
      EditWhenFocused(&content::WebContents::Cut, kEditTries);
      return;
    case mojom::WebViewContextMenuAction::kCopy:
      EditWhenFocused(&content::WebContents::Copy, kEditTries);
      return;
    case mojom::WebViewContextMenuAction::kPaste:
      EditWhenFocused(&content::WebContents::Paste, kEditTries);
      return;
    case mojom::WebViewContextMenuAction::kPasteAndMatchStyle:
      EditWhenFocused(&content::WebContents::PasteAndMatchStyle, kEditTries);
      return;
    case mojom::WebViewContextMenuAction::kDelete:
      EditWhenFocused(&content::WebContents::Delete, kEditTries);
      return;
    case mojom::WebViewContextMenuAction::kSelectAll:
      EditWhenFocused(&content::WebContents::SelectAll, kEditTries);
      return;
    // Chrome also copies the unfiltered URL.
    case mojom::WebViewContextMenuAction::kCopyLinkAddress:
      CopyAddress(params.unfiltered_link_url);
      return;
    case mojom::WebViewContextMenuAction::kSaveLinkAs:
      SaveFrom(*frame, params.link_url, params, /*is_subresource=*/true);
      return;
    // The frame maps the root point to its own coordinates. See
    // RenderFrameHostImpl::TransformRootPointForContextMenuAction.
    case mojom::WebViewContextMenuAction::kCopyImage:
      frame->CopyImageAt(params.x, params.y);
      return;
    case mojom::WebViewContextMenuAction::kCopyMediaAddress:
      CopyAddress(params.src_url);
      return;
    // As in Chrome's ExecSaveAs: the renderer saves a canvas, or an image whose
    // URL was too large to send. Anything else is downloaded again.
    case mojom::WebViewContextMenuAction::kSaveMediaAs:
      if (params.media_type == blink::mojom::ContextMenuDataMediaType::kCanvas ||
          !params.src_url.is_valid()) {
        frame->SaveImageAt(params.x, params.y);
      } else {
        SaveFrom(*frame, params.src_url, params,
                 /*is_subresource=*/!params.is_image_media_plugin_document);
      }
      return;
    case mojom::WebViewContextMenuAction::kInspect:
      Inspector().Run(*frame, gfx::Point(params.x, params.y));
      return;
  }
}

void WebViewGuest::EditWhenFocused(EditCommand command, int tries) {
  CHECK(guest_contents_);
  // Null while focus is outside this guest, when an edit would go to the
  // shell.
  if (guest_contents_->GetFocusedFrame() != nullptr) {
    (guest_contents_.get()->*command)();
    return;
  }
  if (tries == 0) {
    LOG(WARNING) << "domicile: a <webview>'s page never took the focus back "
                    "for an edit from its context menu; the edit is dropped.";
    return;
  }
  base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE,
      base::BindOnce(&WebViewGuest::EditWhenFocused,
                     weak_factory_.GetWeakPtr(), command, tries - 1),
      kEditRetry);
}

void WebViewGuest::Inspect() {
  CHECK(guest_contents_);
  Inspector().Run(*guest_contents_->GetPrimaryMainFrame(), std::nullopt);
}

void WebViewGuest::CopyAddress(const GURL& url) {
  ui::ScopedClipboardWriter writer(ui::ClipboardBuffer::kCopyPaste);
  writer.WriteText(base::UTF8ToUTF16(url.spec()));
}

void WebViewGuest::SaveFrom(content::RenderFrameHost& frame,
                            const GURL& url,
                            const content::ContextMenuParams& params,
                            bool is_subresource) {
  // Match Chrome's referrer and Accept header, which some sites check.
  net::HttpRequestHeaders headers;
  if (params.media_type == blink::mojom::ContextMenuDataMediaType::kImage) {
    headers.SetHeaderIfMissing(net::HttpRequestHeaders::kAccept,
                               blink::network_utils::ImageAcceptHeader());
  }
  guest_contents_->SaveFrameWithHeaders(
      url,
      content::Referrer::SanitizeForRequest(
          url, content::Referrer(params.frame_url.GetAsReferrer(),
                                 params.referrer_policy)),
      headers.ToString(), params.suggested_filename, &frame, is_subresource);
}

void WebViewGuest::RunFileChooser(
    content::RenderFrameHost* render_frame_host,
    scoped_refptr<content::FileSelectListener> listener,
    const blink::mojom::FileChooserParams& params) {
  // Logged before asking; the upload guard greps for it.
  LOG(INFO) << "domicile: a <webview>'s page asked for a file; asking the "
               "shell.";

  // Blink clears `default_file_name` except for saves.
  //
  // Wrapped, as in ChooseDownloadPath, so an unanswered pipe cancels the
  // chooser instead of leaving the page waiting.
  client_->FileChooserRequested(
      AsWebViewFileChooserMode(params.mode),
      AcceptedExtensions(params.accept_types),
      params.default_file_name.BaseName().AsUTF8Unsafe(),
      base::GetHomeDir().AsUTF8Unsafe(),
      mojo::WrapCallbackWithDefaultInvokeIfNotRun(
          base::BindOnce(&FilesChosen, std::move(listener), params.mode),
          std::nullopt));
}

void WebViewGuest::NavigationStateChanged(
    content::WebContents* source,
    content::InvalidateTypes changed_flags) {
  ReportHistory();
  // URL changes also arrive here. See the header for why the flags are
  // ignored.
  ReportPage();
  // Zoom is per site, so navigation can change it.
  ReportZoom();
}

void WebViewGuest::DidChangeVisibleSecurityState() {
  ReportPage();
}

void WebViewGuest::LoadingStateChanged(content::WebContents* source,
                                       bool should_show_loading_ui) {
  ReportLoading(should_show_loading_ui);
}

void WebViewGuest::ReportHistory() {
  CHECK(guest_contents_);

  content::NavigationController& history = guest_contents_->GetController();
  const bool can_go_back = history.CanGoBack();
  const bool can_go_forward = history.CanGoForward();

  // Report only changes; title and favicon updates also call this.
  if (can_go_back != reported_can_go_back_ ||
      can_go_forward != reported_can_go_forward_) {
    reported_can_go_back_ = can_go_back;
    reported_can_go_forward_ = can_go_forward;
    client_->HistoryChanged(can_go_back, can_go_forward);
  }
}

void WebViewGuest::ReportPage() {
  CHECK(guest_contents_);

  // `GetVisibleSecurityState` also reads the visible entry, so the address and
  // the level describe the same page. Never null for a live WebContents.
  content::NavigationEntry* entry =
      guest_contents_->GetController().GetVisibleEntry();

  // The virtual URL is what browsers display (e.g. `view-source:` rewrites).
  const GURL url = entry->GetVirtualURL();

  const std::unique_ptr<security_state::VisibleSecurityState> state =
      security_state::GetVisibleSecurityState(guest_contents_);
  const mojom::WebViewSecurity security =
      AsWebViewSecurity(security_state::GetSecurityLevel(*state));

  // Report only changes; both callers fire for unrelated updates too.
  if (url != reported_url_ || security != reported_security_) {
    reported_url_ = url;
    reported_security_ = security;
    client_->PageChanged(url, security);
  }
}

void WebViewGuest::ReportLoading(bool should_show_loading_ui) {
  CHECK(guest_contents_);

  // As in Chrome: the flag says whether this kind of load shows a spinner, and
  // IsLoading() says whether a load is in progress. The flag alone stays set
  // after the load finishes.
  const bool loading = guest_contents_->IsLoading() && should_show_loading_ui;

  // Report only changes.
  if (loading != reported_loading_) {
    reported_loading_ = loading;
    client_->LoadingChanged(loading);
  }
}

namespace {

// The assumed size of an icon whose link gives none: 180 px for a touch icon,
// 16 px otherwise.
int AssumedSize(const blink::mojom::FaviconURL& icon) {
  return icon.icon_type == blink::mojom::FaviconIconType::kFavicon ? 16 : 180;
}

// Picks the best icon for a launcher: SVG first, then the largest, then the
// first. Matches the compositor's ranking in `domicile_host::favicons`.
GURL BestFavicon(const std::vector<blink::mojom::FaviconURLPtr>& candidates) {
  const blink::mojom::FaviconURL* best = nullptr;
  bool best_drawn = false;
  int best_size = 0;
  for (const blink::mojom::FaviconURLPtr& icon : candidates) {
    if (icon->icon_type == blink::mojom::FaviconIconType::kInvalid ||
        !icon->icon_url.is_valid()) {
      continue;
    }
    const bool drawn =
        base::EndsWith(icon->icon_url.path(), ".svg",
                       base::CompareCase::INSENSITIVE_ASCII);
    int size = 0;
    for (const gfx::Size& stated : icon->icon_sizes) {
      size = std::max(size, std::max(stated.width(), stated.height()));
    }
    if (size == 0) {
      size = AssumedSize(*icon);
    }
    if (!best || drawn > best_drawn ||
        (drawn == best_drawn && size > best_size)) {
      best = icon.get();
      best_drawn = drawn;
      best_size = size;
    }
  }
  return best ? best->icon_url : GURL();
}

}  // namespace

void WebViewGuest::DidUpdateFaviconURL(
    content::RenderFrameHost* render_frame_host,
    const std::vector<blink::mojom::FaviconURLPtr>& candidates,
    blink::mojom::FaviconUpdateReason reason) {
  // Report only changes; scripts touching any head link trigger this.
  const GURL icon = BestFavicon(candidates);
  if (icon != reported_favicon_) {
    reported_favicon_ = icon;
    client_->FaviconChanged(icon);
  }
}

void WebViewGuest::PrimaryPageChanged(content::Page& page) {
  EnablePreferredSize();
  EndFind();
  if (!reported_favicon_.is_empty()) {
    reported_favicon_ = GURL();
    client_->FaviconChanged(reported_favicon_);
  }
}

void WebViewGuest::ReportZoom() {
  const double zoom = GetZoomFactor();

  // ZoomValuesEqual, not `!=`: the factor round-trips through a logarithm.
  if (!blink::ZoomValuesEqual(zoom, reported_zoom_)) {
    const double was = reported_zoom_;
    reported_zoom_ = zoom;
    client_->ZoomChanged(zoom);
    zoom_callbacks_.Notify(was, zoom);
  }
}

void WebViewGuest::DidReceiveFindReply(int request_id,
                                       int number_of_matches,
                                       const gfx::Rect& selection_rect,
                                       int active_match_ordinal,
                                       bool final_update) {
  // Drop replies to a stopped or replaced search.
  if (find_text_.empty() || request_id < find_session_id_) {
    return;
  }
  // -1 means "no change" in either field.
  ReportFind(
      number_of_matches == -1 ? reported_find_matches_ : number_of_matches,
      active_match_ordinal == -1 ? reported_find_active_match_
                                 : active_match_ordinal);
}

void WebViewGuest::ReportFind(int matches, int active_match) {
  if (matches != reported_find_matches_ ||
      active_match != reported_find_active_match_) {
    reported_find_matches_ = matches;
    reported_find_active_match_ = active_match;
    client_->FindChanged(matches, active_match);
  }
}

void WebViewGuest::EndFind() {
  find_text_.clear();
  ReportFind(0, 0);
}

bool WebViewGuest::IsWebContentsCreationOverridden(
    content::RenderFrameHost* opener,
    content::SiteInstance* source_site_instance,
    content::mojom::WindowContainerType window_container_type,
    const GURL& opener_url,
    const std::string& frame_name,
    const GURL& target_url) {
  return true;
}

content::WebContents* WebViewGuest::CreateCustomWebContents(
    content::RenderFrameHost* opener,
    content::SiteInstance* source_site_instance,
    bool is_new_browsing_instance,
    const GURL& opener_url,
    const std::string& frame_name,
    const GURL& target_url,
    WindowOpenDisposition disposition,
    const blink::mojom::WindowFeatures& window_features,
    const content::StoragePartitionConfig& partition_config,
    content::SessionStorageNamespaceHandle* session_storage_namespace) {
  // Content cannot create this window for a guest without its own
  // SiteInstance (see the class comment), so refuse it and open a browser
  // window at the address instead.
  //
  // `disposition` and `window_features` are dropped: the shell lays out
  // browser windows itself.
  ReportNewWindow(target_url);
  return nullptr;
}

content::WebContents* WebViewGuest::OpenURLFromTab(
    content::WebContents* source,
    const content::OpenURLParams& params,
    base::OnceCallback<void(content::NavigationHandle&)>
        navigation_handle_callback) {
  CHECK(guest_contents_);

  // `source` is always `guest_contents_`, the only WebContents this delegates
  // for.
  switch (params.disposition) {
    case WindowOpenDisposition::CURRENT_TAB: {
      // LoadURLParams(params) keeps the referrer, transition, POST body and
      // initiator, so this continues the renderer's navigation.
      //
      // Logged before loading. `guard-webview-routed-link.sh` greps for this
      // to tell a routed navigation from one Blink handled in-process.
      LOG(INFO) << "domicile: a <webview> followed a link its page could not "
                   "follow itself, to "
                << params.url.possibly_invalid_spec();

      base::WeakPtr<content::NavigationHandle> navigation =
          guest_contents_->GetController().LoadURLWithParams(
              content::NavigationController::LoadURLParams(params));

      // The handle is null if the controller refused the navigation, which is
      // not an error.
      if (navigation_handle_callback && navigation) {
        std::move(navigation_handle_callback).Run(*navigation);
      }
      return guest_contents_;
    }

    case WindowOpenDisposition::NEW_FOREGROUND_TAB:
    case WindowOpenDisposition::NEW_BACKGROUND_TAB:
    case WindowOpenDisposition::NEW_POPUP:
    case WindowOpenDisposition::NEW_WINDOW: {
      // Same as CreateCustomWebContents; middle and Ctrl clicks arrive here
      // instead.
      //
      // Logged here, not in the shared ReportNewWindow, so
      // `guard-webview-routed-link.sh` can tell which path ran.
      LOG(INFO) << "domicile: a <webview> routed a second-window gesture its "
                   "page could not perform itself, to "
                << params.url.possibly_invalid_spec();

      ReportNewWindow(params.url);
      return nullptr;
    }

    default: {
      // Other dispositions (save to disk, singleton tab, off-the-record, ...)
      // need browser UI the desktop lacks. Refuse with a warning, not
      // silently.
      //
      // A `default` so new upstream values in this shared //ui/base enum do
      // not break the build.
      LOG(WARNING) << "domicile: a <webview> refused a navigation to "
                   << params.url.possibly_invalid_spec()
                   << " asked for with a disposition a browser window has no "
                      "answer for: "
                   << static_cast<int>(params.disposition);
      return nullptr;
    }
  }
}

void WebViewGuest::ReportNewWindow(const GURL& target_url) {
  // A `window.open()` with no URL wants a handle to write into, which a
  // browser window cannot provide. Refuse it instead of opening a blank one.
  if (!target_url.is_valid()) {
    LOG(WARNING) << "domicile: a <webview>'s page asked for a window with no "
                    "address to open; refused, and no window is opened.";
    return;
  }

  // A warning because the page did not get the window it asked for (no
  // opener, no POST body).
  LOG(WARNING) << "domicile: a <webview> refused to open a window for "
               << target_url.possibly_invalid_spec()
               << "; a browser window was opened at it instead.";

  Host().Open(*guest_contents_->GetBrowserContext(), target_url);
}

void WebViewGuest::CloseContents(content::WebContents* source) {
  LOG(INFO) << "domicile: a <webview>'s page asked to close.";
  Close();
}

void WebViewGuest::Close() {
  if (window_id_.empty()) {
    client_->CloseRequested();
  } else {
    Host().Close(*guest_contents_->GetBrowserContext(), window_id_);
  }
}

void WebViewGuest::ActivateContents(content::WebContents* contents) {
  LOG(INFO) << "domicile: a <webview>'s page asked to be in front.";
  client_->FocusRequested();
}

void WebViewGuest::EnablePreferredSize() {
  LOG(INFO) << "domicile: asked a <webview>'s page for its content size.";
  guest_contents_->GetPrimaryMainFrame()
      ->GetRenderViewHost()
      ->EnablePreferredSizeMode();
}

void WebViewGuest::UpdatePreferredSize(content::WebContents* web_contents,
                                       const gfx::Size& pref_size) {
  LOG(INFO) << "domicile: a <webview>'s page reported its content size, "
            << pref_size.ToString() << ".";
  content_size_ = pref_size;
  client_->ContentSizeChanged(pref_size.width(), pref_size.height());
}

void WebViewGuest::RequestFocus() {
  LOG(INFO) << "domicile: an extension asked for a <webview> in front.";
  client_->FocusRequested();
}

void WebViewGuest::RequestClose() {
  LOG(INFO) << "domicile: an extension asked to close a <webview>.";
  Close();
}

void WebViewGuest::RequestWindow(const GURL& url) {
  ReportNewWindow(url);
}

void WebViewGuest::RequestPopupWindow(int window_id,
                                      const GURL& url,
                                      int width,
                                      int height) {
  // guard-webview-popup-window.sh reads this to tell "never asked" from
  // "asked but nothing opened".
  LOG(INFO) << "domicile: an extension asked for popup window " << window_id
            << "; a browser window was opened for it.";
  Host().OpenPopupWindow(*guest_contents_->GetBrowserContext(), window_id, url,
                         width, height);
}

base::CallbackListSubscription WebViewGuest::AddFocusedCallback(
    base::RepeatingClosure focused) {
  return focused_callbacks_.Add(std::move(focused));
}

void WebViewGuest::Focused() {
  focused_callbacks_.Notify();
}

base::CallbackListSubscription WebViewGuest::AddZoomChangedCallback(
    ZoomChangedCallback changed) {
  return zoom_callbacks_.Add(std::move(changed));
}

void WebViewGuest::WebContentsDestroyed() {
  zoom_subscription_ = {};
  guest_contents_ = nullptr;
  if (self_owned_) {
    delete this;
  }
}

void BindWebViewGuestHost(
    content::RenderFrameHost* frame,
    mojo::PendingReceiver<mojom::WebViewGuestHost> receiver,
    GuestCreatedCallback created) {
  // A DocumentService deletes itself with the document.
  new WebViewGuestHost(*frame, std::move(receiver), std::move(created));
}

}  // namespace domicile
