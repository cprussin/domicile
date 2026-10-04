// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/web_view_guest.h"

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <utility>

#include "base/check.h"
#include "base/files/file_enumerator.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/memory/ptr_util.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/supports_user_data.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "components/domicile/browser/file_choice.h"
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
#include "content/public/common/stop_find_action.h"
#include "content/public/common/url_constants.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"
#include "mojo/public/cpp/bindings/message.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "third_party/blink/public/mojom/choosers/file_chooser.mojom.h"
#include "third_party/blink/public/mojom/favicon/favicon_url.mojom.h"
#include "third_party/blink/public/mojom/frame/find_in_page.mojom.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
#include "ui/gfx/geometry/size.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/dom/dom_key.h"
#include "ui/events/keycodes/dom/keycode_converter.h"

namespace domicile {
namespace {

// Why a CreateGuest is a bad message, whether it waited or not.
constexpr char kNotItsOwnFrame[] =
    "domicile: a <webview> may only ask for a guest for its own frame.";

// The interface a <webview> asks for a guest over, for one document.
//
// A DocumentService rather than a self-owned receiver, because everything it
// does is relative to the document that asked: the frame it is handed has to be
// that document's own child, and a document that navigates away has no claim on
// the guests the previous one made.
//
// AND A WebContentsObserver, because the placeholder can arrive after the
// request for it. The element sends CreateGuest over the browser interface
// broker, a pipe of its own, while the frame it names is announced over the
// frame's channel -- so under load the request wins and the frame is not there
// yet. That is the order, not a fault in it, and the request waits for the
// frame rather than being dropped: dropping it was a <webview> that showed
// nothing, which is how concurrent guards found it.
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
  // A CreateGuest whose placeholder the browser has not seen yet.
  //
  // WITH THE CALLBACK FOR REFUSING IT, which can only be taken while the
  // message is being dispatched: whether the frame is this document's child is
  // not known until the frame exists, which is after the dispatch is over.
  struct WaitingRequest {
    blink::LocalFrameToken placeholder_frame;
    mojo::PendingReceiver<mojom::WebViewGuest> guest;
    mojo::PendingRemote<mojom::WebViewGuestClient> client;
    std::optional<int> popup_window;
    mojo::ReportBadMessageCallback report_bad_message;
  };

  // mojom::WebViewGuestHost:
  void CreateGuest(const blink::LocalFrameToken& placeholder_frame,
                   mojo::PendingReceiver<mojom::WebViewGuest> guest,
                   mojo::PendingRemote<mojom::WebViewGuestClient> client,
                   std::optional<int32_t> popup_window) override {
    content::RenderFrameHost* placeholder = FindPlaceholder(placeholder_frame);

    if (placeholder == nullptr) {
      // ONE REQUEST WAITS PER PIPE, which is the cap on what a renderer can
      // make this hold: the element sends one CreateGuest on a pipe of its own.
      if (waiting_.has_value()) {
        ReportBadMessageAndDeleteThis(
            "domicile: a <webview> may only ask for one guest.");
        return;
      }
      // The line that tells a guest that waited from one that did not, in a
      // run that shows nothing.
      LOG(INFO) << "domicile: a <webview> asked for a guest before its frame "
                   "arrived; waiting for it.";
      waiting_ =
          WaitingRequest{placeholder_frame, std::move(guest), std::move(client),
                         popup_window, mojo::GetBadMessageCallback()};
      return;
    }

    // A lie, and the only one available here: a document claiming a guest for
    // a frame that is not its own child could put a page it does not own
    // inside somebody else's element.
    //
    // DocumentService's own version rather than mojo::ReportBadMessage, which
    // its header asks for: it resets the receiver before deleting, so a reply
    // callback does not have to be run with made-up arguments first.
    if (placeholder->GetParent() != &render_frame_host()) {
      ReportBadMessageAndDeleteThis(kNotItsOwnFrame);
      return;
    }

    WebViewGuest::CreateAndAttach(render_frame_host(), *placeholder,
                                  std::move(guest), std::move(client),
                                  popup_window, created_);
  }

  // content::WebContentsObserver:
  //
  // POSTED RATHER THAN RUN HERE. This is called from inside
  // FrameTree::AddFrame, before content has finished adding the frame, and
  // creating a guest and preparing the frame for it from there is re-entry the
  // ordinary path never makes. A task later is when a CreateGuest that lost no
  // race is read.
  void RenderFrameCreated(content::RenderFrameHost* frame) override {
    if (!waiting_.has_value() ||
        frame->GetFrameToken() != waiting_->placeholder_frame) {
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

    // Gone between arriving and this task -- the <webview> was removed from
    // the document. A race, not a lie, so the pipe is dropped and the
    // element's remote learns it: killing the shell over its own timing would
    // be the fork's bug and not the shell's.
    if (placeholder == nullptr) {
      LOG(WARNING) << "domicile: the frame a <webview> asked a guest for is "
                      "already gone.";
      return;
    }

    // The same refusal as CreateGuest's, through the callback taken while the
    // request was dispatched: ReportBadMessageAndDeleteThis can only be called
    // during one.
    if (placeholder->GetParent() != &render_frame_host()) {
      std::move(request.report_bad_message).Run(kNotItsOwnFrame);
      ResetAndDeleteThis();
      return;
    }

    WebViewGuest::CreateAndAttach(
        render_frame_host(), *placeholder, std::move(request.guest),
        std::move(request.client), request.popup_window, created_);
  }

  // The frame `placeholder_frame` names, or null if the browser has none.
  //
  // Same process as the asking document, always: the placeholder is the frame
  // the owner element created and never navigated, so it is still the local
  // about:blank frame its parent made.
  content::RenderFrameHost* FindPlaceholder(
      const blink::LocalFrameToken& placeholder_frame) {
    return content::RenderFrameHost::FromFrameToken(
        content::GlobalRenderFrameHostToken(
            render_frame_host().GetProcess()->GetID(), placeholder_frame));
  }

  // Held for as long as the element's pipe is open, which is why it cannot
  // leak: the element keeps this pipe for its own life. See
  // HTMLWebViewElement::RequestGuest.
  std::optional<WaitingRequest> waiting_;

  // The embedder's helpers, for every guest this document makes.
  const GuestCreatedCallback created_;

  base::WeakPtrFactory<WebViewGuestHost> weak_factory_{this};
};

// Chromium's answer for a page, as the one this fork puts on the wire.
//
// AN EXPLICIT SWITCH WITH NO DEFAULT ARM, which is the whole reason this is a
// function rather than a cast. `security_state::SecurityLevel` is Chromium's
// and its numbering has already changed once -- three members are commented
// out at our pin -- so a `static_cast` would turn a renumbering upstream into a
// browser window drawing the wrong lock, silently. Without a default, a level
// Chromium adds stops the fork's build instead.
//
// SECURITY_LEVEL_COUNT is not a level. It is the enum's bound, it is never
// returned by GetSecurityLevel, and it is here because leaving it out is what
// would reintroduce the default arm.
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

// What a guest's WebContents carries it under, so that FromWebContents can find
// it from a WebContents and nothing else.
constexpr char kGuestUserDataKey[] = "domicile_web_view_guest";

// A weak pointer rather than the guest itself: the guest is not the
// WebContents' to own. Both go together in WebContentsDestroyed anyway, so
// this never outlives what it points at by more than that call.
class GuestLink : public base::SupportsUserData::Data {
 public:
  explicit GuestLink(base::WeakPtr<WebViewGuest> guest)
      : guest_(std::move(guest)) {}

  WebViewGuest* guest() const { return guest_.get(); }

 private:
  base::WeakPtr<WebViewGuest> guest_;
};

// Blink's five modes as the four a picker draws. See WebViewFileChooserMode in
// the mojom. No default arm, so a mode Blink adds stops this build.
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

// The absolute paths a shell's answer names, or nothing for an answer that is
// not one to `mode` -- which the element refuses before sending, so nothing
// here is an answer a shell gave.
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

// Every file under `folder`, which is what a folder upload hands the page.
// Blocking, so it runs on the thread pool.
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

// The shell's answer to a page's `<input type="file">`, handed to content.
//
// A FREE FUNCTION AND NOT A METHOD, because the listener must hear an answer
// whatever happens to the guest: content expects every listener to be told
// exactly once, and a callback bound to a guest that has gone would drop it.
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

// The shell's answer to "where does this download go?", handed to //chrome.
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

// The shell's answer to a dialog the browser would have drawn, handed back to
// the dialog. See WebViewGuest::ChooseFiles.
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
    std::optional<int> popup_window,
    const GuestCreatedCallback& created) {
  std::unique_ptr<WebViewGuest> guest = base::WrapUnique(new WebViewGuest(
      owner, std::move(receiver), std::move(client), popup_window));

  // `guest_delegate` is what makes the new WebContents a guest, and content
  // asks it for its owner while constructing -- which is why the delegate is
  // built first and knows its owner from its constructor.
  //
  // No SiteInstance and no StoragePartitionConfig: the guest belongs in the
  // default partition, where the user's cookies are. See the class comment.
  content::WebContents::CreateParams params(owner.GetBrowserContext());
  params.guest_delegate = guest.get();
  std::unique_ptr<content::WebContents> contents =
      content::WebContents::Create(params);

  guest->guest_contents_ = contents.get();
  contents->SetUserData(
      kGuestUserDataKey,
      std::make_unique<GuestLink>(guest->weak_factory_.GetWeakPtr()));
  guest->owned_guest_contents_ = std::move(contents);
  guest->Observe(guest->guest_contents_);
  guest->guest_contents_->SetDelegate(guest.get());

  // The embedder's helpers, now: after the delegate, which some of them ask
  // for, and before the first navigation, which some of them record.
  created.Run(*guest->guest_contents_);

  // Unretained because the subscription is a member: it is dropped with this
  // object, and before that with the WebContents -- see WebContentsDestroyed.
  guest->zoom_subscription_ =
      content::HostZoomMap::GetForWebContents(guest->guest_contents_)
          ->AddZoomLevelChangedCallback(base::BindRepeating(
              [](WebViewGuest* guest,
                 const content::HostZoomMap::ZoomLevelChange& change) {
                guest->ReportZoom();
              },
              base::Unretained(guest.get())));

  // Asynchronous, and the API says why: the placeholder is about to be swapped
  // out, so every beforeunload handler under it has to answer first, and a
  // cross-process placeholder has to be replaced by a same-process one. What
  // comes back is the frame that is safe to swap, which may not be the frame
  // handed in.
  placeholder.PrepareForInnerWebContentsAttach(
      base::BindOnce(&WebViewGuest::Attach, std::move(guest)));
}

// static
void WebViewGuest::Attach(std::unique_ptr<WebViewGuest> guest,
                          content::RenderFrameHost* outer_contents_frame) {
  // Null is a refusal: a beforeunload handler kept the frame, or the frame was
  // detached while this was in flight. Returning destroys `guest`, and with it
  // the WebContents it still owns.
  if (outer_contents_frame == nullptr) {
    return;
  }

  // The frame's own WebContents rather than the owner this was built with:
  // AttachInnerWebContents CHECKs that they are the same, and a shell that
  // navigated while the attach was in flight has a new document -- and so a new
  // RenderFrameHost -- behind the id this object holds.
  content::WebContents* owner =
      content::WebContents::FromRenderFrameHost(outer_contents_frame);
  CHECK(owner);

  std::unique_ptr<content::WebContents> contents =
      std::move(guest->owned_guest_contents_);

  // From here the guest is scoped to the guest page's lifetime, exactly as
  // GuestViewBase does it: the outer WebContents takes the inner one, and this
  // object self-destructs in WebContentsDestroyed.
  guest->self_owned_ = true;
  guest.release();

  // `is_full_page` is false, and it is not a detail. It means "give the inner
  // WebContents focus", and it CHECKs that the outer WebContents has exactly
  // one inner one -- which a shell with two browser windows open does not.
  // Focus is the shell's to move -- `BrowserWindow.tsx` calls `view.focus()`
  // when a browser window becomes the one the user is working in -- and this
  // flag is not how.
  owner->AttachInnerWebContents(std::move(contents), outer_contents_frame,
                                /*is_full_page=*/false);

  // The one line that says the guest exists, and it earns its place: a
  // <webview> showing nothing has four possible causes and only this tells
  // three of them from the fourth. `domicile:` is the prefix
  // engine-diagnostics.sh greps the browser's log for.
  LOG(INFO) << "domicile: attached a guest to a <webview>.";
}

WebViewGuest::WebViewGuest(
    content::RenderFrameHost& owner,
    mojo::PendingReceiver<mojom::WebViewGuest> receiver,
    mojo::PendingRemote<mojom::WebViewGuestClient> client,
    std::optional<int> popup_window)
    : owner_rfh_id_(owner.GetGlobalId()),
      popup_window_(popup_window),
      receiver_(this, std::move(receiver)),
      client_(std::move(client)) {}

WebViewGuest::~WebViewGuest() = default;

// static
WebViewGuest* WebViewGuest::FromWebContents(content::WebContents* contents) {
  const auto* link =
      static_cast<GuestLink*>(contents->GetUserData(kGuestUserDataKey));
  return link == nullptr ? nullptr : link->guest();
}

void WebViewGuest::ChooseDownloadPath(
    const base::FilePath& suggested_path,
    base::OnceCallback<void(std::optional<base::FilePath>)> chosen) {
  // Before the ask, so the line means "the shell was asked" whether or not it
  // answers. The download guard greps for it.
  LOG(INFO) << "domicile: a <webview>'s download asked the shell where to go.";

  // No accept list: a download can be saved under any name the user likes,
  // and the suggestion already carries the one the site gave it.
  //
  // WRAPPED so that a pipe closing unanswered -- the element removed, the shell
  // reloaded -- still tells //chrome, which holds the download waiting.
  client_->FileChooserRequested(
      mojom::WebViewFileChooserMode::kSave, {},
      suggested_path.BaseName().AsUTF8Unsafe(),
      base::GetHomeDir().AsUTF8Unsafe(),
      mojo::WrapCallbackWithDefaultInvokeIfNotRun(
          HeldOpen(base::BindOnce(&DownloadPathChosen, std::move(chosen))),
          std::nullopt));
}

void WebViewGuest::ChooseFiles(
    mojom::WebViewFileChooserMode mode,
    const std::vector<std::string>& accept,
    const base::FilePath& suggested_path,
    base::OnceCallback<void(std::optional<std::vector<base::FilePath>>)>
        chosen) {
  // WRAPPED, for the reason ChooseDownloadPath's ask is: the dialog's caller
  // holds its question open until it hears something.
  client_->FileChooserRequested(
      mode, accept, suggested_path.BaseName().AsUTF8Unsafe(),
      base::GetHomeDir().AsUTF8Unsafe(),
      mojo::WrapCallbackWithDefaultInvokeIfNotRun(
          HeldOpen(base::BindOnce(&DialogFilesChosen, mode, std::move(chosen))),
          std::nullopt));
}

void WebViewGuest::Navigate(const GURL& url) {
  // A CHECK rather than a guard: this object is destroyed with the guest's
  // WebContents, so there is no moment at which the pipe is open and the
  // WebContents is gone.
  //
  // Before the attach as well as after, and that is why the element needs no
  // callback to wait on: a guest still waiting for its placeholder navigates
  // all the same, because content brings the browser side of a guest up during
  // the attach whether or not it has been anywhere.
  CHECK(guest_contents_);

  // ONE REFUSAL, AND IT IS NOT FOR THE SHELL'S SAKE. Only the shell's
  // document reaches this, and it already holds `Spawn` -- but the addresses it
  // hands over are often a page's (`target="_blank"`) or an extension's
  // (`tabs.update`), and a guest on domicile:// would be a second shell for
  // them. Refused the way content refuses a page an address it may not ask
  // for: the guest shows about:blank#blocked, so an address bar names it.
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
  // The same CHECK Navigate makes, and for the same reason: this object is
  // destroyed with the guest's WebContents, so there is no moment at which the
  // pipe is open and the WebContents is gone.
  CHECK(guest_contents_);

  // NOT GUARDED WITH CanGoBack(), which would be a guard on a condition the
  // callee already answers: GoBack returns without navigating when there is
  // nowhere to go. An address bar whose buttons cannot yet be grayed out
  // presses this with an empty history as a matter of course, so a back with
  // nowhere to go is the ordinary case rather than a bad message.
  guest_contents_->GetController().GoBack();
}

void WebViewGuest::GoForward() {
  CHECK(guest_contents_);
  guest_contents_->GetController().GoForward();
}

void WebViewGuest::Stop() {
  CHECK(guest_contents_);
  // The WebContents rather than its controller, which has no Stop: a pending
  // navigation is the WebContents', and canceling it is what an address bar's
  // stop button means.
  guest_contents_->Stop();
}

void WebViewGuest::Reload() {
  CHECK(guest_contents_);
  // `check_for_repost` true, which is what a browser passes in production. It
  // reaches this delegate's ShowRepostFormWarningDialog, which is content's
  // do-nothing default -- so reloading a POST result currently does nothing
  // rather than silently reposting. That is the guest's "refuses everything an
  // embedder is asked for" gap, and reposting without asking would be the
  // worse half of it to close by accident.
  guest_contents_->GetController().Reload(content::ReloadType::NORMAL,
                                          /*check_for_repost=*/true);
}

void WebViewGuest::SetZoom(double factor) {
  CHECK(guest_contents_);

  // The element throws a RangeError for this before sending it, so a factor
  // out of range here is a renderer that is not running the element's code.
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
  // The element sends StopFinding for an empty string, as it throws for a
  // SetZoom out of range, and content NOTREACHEDs on one.
  if (search.empty()) {
    receiver_.ReportBadMessage(
        "domicile: a <webview> asked to find nothing in its page.");
    return;
  }

  // Chrome's find bar's rule: the text it is already searching for is a step
  // to the next match, and anything else starts over.
  const bool new_session = search != find_text_;
  if (new_session) {
    find_text_ = search;
  }

  auto options = blink::mojom::FindOptions::New();
  options->forward = forward;
  options->new_session = new_session;
  // Not skipped: the delay is content's own mitigation for a search typed a
  // letter at a time, which is exactly how a find bar sends one.
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

void WebViewGuest::ListDirectory(const std::string& path,
                                 ListDirectoryCallback callback) {
  const std::optional<base::FilePath> directory =
      ResolvedPath(base::GetHomeDir(), path);
  // The element throws a TypeError for this before sending it, as it does for
  // a SetZoom out of range.
  if (!directory.has_value()) {
    std::move(callback).Run(std::nullopt);
    receiver_.ReportBadMessage(
        "domicile: a <webview> asked to list a path that climbs with `..`.");
    return;
  }
  // Not a bad message: an answer and a listing travel on different pipes, so a
  // listing asked for just before the answer can arrive just after it.
  if (open_choosers_ == 0) {
    std::move(callback).Run(std::nullopt);
    return;
  }
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock()},
      base::BindOnce(&DirectoryEntries, *directory), std::move(callback));
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

  // The site's zoom rather than this window's, which is Chrome's rule and what
  // HostZoomMap::SetZoomLevel does for a WebContents with no temporary level.
  content::HostZoomMap::SetZoomLevel(guest_contents_,
                                     blink::ZoomFactorToZoomLevel(factor));

  // HostZoomMap has already said so through the subscription, for a site that
  // has an address. This is the answer for one that does not -- an error page,
  // a guest that has not committed -- and the comparison makes it free when
  // the answer was already sent.
  ReportZoom();
}

content::WebContents* WebViewGuest::GetOwnerWebContents() {
  content::RenderFrameHost* owner =
      content::RenderFrameHost::FromID(owner_rfh_id_);
  return owner ? content::WebContents::FromRenderFrameHost(owner) : nullptr;
}

content::RenderFrameHost* WebViewGuest::GetProspectiveOuterDocument() {
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

  // EVERY EVENT, including the releases and the ones no chord matches. A
  // modifier is a state the shell holds rather than a keystroke it answers --
  // Alt hands the pointer back to the page, Shift makes the drag a resize --
  // and the registry drops the ones that changed nothing, so this is a compare
  // and not a message. Doing it before the match, so that a chord's own Alt is
  // reported rather than swallowed with the key.
  ShortcutRegistry::Get().SetModifiers(held);

  // Presses only, which is what the control protocol carries: a release
  // changes nothing and would arrive as a second event for one keystroke.
  //
  // And not an auto-repeat, which is the page's own reading of the same rule --
  // a held key repeats tens of times a second and only the first of them acts.
  const bool pressed =
      event.GetType() == blink::WebInputEvent::Type::kRawKeyDown ||
      event.GetType() == blink::WebInputEvent::Type::kKeyDown;
  if (!pressed || (modifiers & blink::WebInputEvent::kIsAutoRepeat) != 0) {
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }

  // Evdev, because that is the numbering the control protocol speaks and the
  // one the shell claimed its chords in. Zero is a key with no evdev code at
  // all, which no claim can name.
  const int evdev = ui::KeycodeConverter::DomCodeToEvdevCode(
      static_cast<ui::DomCode>(event.dom_code));
  if (evdev == 0) {
    return content::KeyboardEventProcessingResult::NOT_HANDLED;
  }

  // HANDLED rather than NOT_HANDLED, and that is the half that makes a claim a
  // claim: the guest's page never sees the key, so a site that binds Alt+Tab
  // for itself cannot take the desktop's chord away from the user.
  //
  // And told to the page this `<webview>` is in, rather than to every page of
  // the desk: each monitor is a page with a channel of its own, and a chord
  // told to all of them was run once per monitor.
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

  // Presses, as PreHandleKeyboardEvent counts them, and auto-repeats among
  // them: Ctrl held on the plus key zooms the whole way in Chrome, one step a
  // repeat, and `repeat` on the event is how a shell tells them apart.
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
  return true;
}

void WebViewGuest::RunFileChooser(
    content::RenderFrameHost* render_frame_host,
    scoped_refptr<content::FileSelectListener> listener,
    const blink::mojom::FileChooserParams& params) {
  // The line that tells a picker the shell never drew from a question that
  // never left the browser. The upload guard greps for it.
  LOG(INFO) << "domicile: a <webview>'s page asked for a file; asking the "
               "shell.";

  // `default_file_name` is empty for every mode but a save -- Blink clears it
  // -- so it is the suggestion as it stands.
  //
  // WRAPPED, for the reason ChooseDownloadPath's ask is: content holds the
  // page's chooser open until the listener hears something, and a pipe that
  // closes unanswered has to be a cancel rather than a page that never hears.
  client_->FileChooserRequested(
      AsWebViewFileChooserMode(params.mode),
      AcceptedExtensions(params.accept_types),
      params.default_file_name.BaseName().AsUTF8Unsafe(),
      base::GetHomeDir().AsUTF8Unsafe(),
      mojo::WrapCallbackWithDefaultInvokeIfNotRun(
          HeldOpen(
              base::BindOnce(&FilesChosen, std::move(listener), params.mode)),
          std::nullopt));
}

mojom::WebViewGuestClient::FileChooserRequestedCallback WebViewGuest::HeldOpen(
    mojom::WebViewGuestClient::FileChooserRequestedCallback answer) {
  ++open_choosers_;
  return base::BindOnce(&WebViewGuest::ChooserAnswered,
                        weak_factory_.GetWeakPtr(), std::move(answer));
}

// static
void WebViewGuest::ChooserAnswered(
    base::WeakPtr<WebViewGuest> guest,
    mojom::WebViewGuestClient::FileChooserRequestedCallback answer,
    const std::optional<std::vector<std::string>>& paths) {
  if (guest) {
    CHECK_GT(guest->open_choosers_, 0u);
    --guest->open_choosers_;
  }
  std::move(answer).Run(paths);
}

void WebViewGuest::NavigationStateChanged(
    content::WebContents* source,
    content::InvalidateTypes changed_flags) {
  ReportHistory();
  // The address as well as the history, from the same call: content reports
  // INVALIDATE_TYPE_URL through here, and the flags are not read for the
  // reason the header gives -- what decides whether anything moved is the
  // comparison inside, not a flag meaning "some browser UI is stale".
  ReportPage();
  // And the zoom, which is the site's: a page that moved to a site zoomed
  // differently has changed zoom without anybody setting it.
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
  // The same CHECK the four controls make: this object is destroyed with the
  // guest's WebContents, and content does not call a delegate of a WebContents
  // it has already destroyed.
  CHECK(guest_contents_);

  content::NavigationController& history = guest_contents_->GetController();
  const bool can_go_back = history.CanGoBack();
  const bool can_go_forward = history.CanGoForward();

  // A CHANGE, not a notification. See the header: this call is also how a
  // title and a favicon arrive, and a chrome that re-rendered its address bar
  // for a favicon would be re-rendering it for every page it loads.
  if (can_go_back != reported_can_go_back_ ||
      can_go_forward != reported_can_go_forward_) {
    reported_can_go_back_ = can_go_back;
    reported_can_go_forward_ = can_go_forward;
    client_->HistoryChanged(can_go_back, can_go_forward);
  }
}

void WebViewGuest::ReportPage() {
  // The same CHECK ReportHistory makes, and for the same reason: content does
  // not call a delegate of a WebContents it has already destroyed.
  CHECK(guest_contents_);

  // ONE ENTRY, READ ONCE, FOR BOTH HALVES. `GetVisibleSecurityState` reads
  // `GetVisibleEntry()` itself, so taking the address from the same call is
  // what keeps the lock and the address describing one page -- see the header.
  // It is never null for a live WebContents at this pin: content always has an
  // entry, and content_utils.cc dereferences it without a check for that
  // reason.
  content::NavigationEntry* entry =
      guest_contents_->GetController().GetVisibleEntry();

  // THE VIRTUAL URL, WHICH IS WHAT A BROWSER SHOWS. `view-source:` and the
  // other rewrites live in the virtual URL; the real one is what was fetched.
  // A chrome shown the real one would disagree with every other browser about
  // what page the user is looking at.
  const GURL url = entry->GetVirtualURL();

  const std::unique_ptr<security_state::VisibleSecurityState> state =
      security_state::GetVisibleSecurityState(guest_contents_);
  const mojom::WebViewSecurity security =
      AsWebViewSecurity(security_state::GetSecurityLevel(*state));

  // A CHANGE, not a notification, exactly as the two reports above are. Both
  // hooks that reach here fire for things the other one is about -- a cert
  // arriving is not a navigation and a navigation is not a cert -- so without
  // this the element would get a message and the shell's page a DOM event for
  // every commit, every title and every favicon.
  if (url != reported_url_ || security != reported_security_) {
    reported_url_ = url;
    reported_security_ = security;
    client_->PageChanged(url, security);
  }
}

void WebViewGuest::ReportLoading(bool should_show_loading_ui) {
  // The same CHECK ReportHistory makes, and for the same reason: content does
  // not call a delegate of a WebContents it has already destroyed.
  CHECK(guest_contents_);

  // BOTH HALVES, which is how Chrome's own browser window reads this pair:
  // `should_show_loading_ui` says whether a load of this kind is one a browser
  // spins for -- false for a same-document navigation -- and `IsLoading()`
  // says whether one is happening at all. A spinner driven by the flag alone
  // would keep turning after the page arrived, because the call that says a
  // load finished carries the same flag as the call that said it started.
  const bool loading = guest_contents_->IsLoading() && should_show_loading_ui;

  // A CHANGE, not a notification, exactly as ReportHistory is: this call
  // arrives for navigations that start no load a browser would show, and a
  // chrome that re-rendered its address bar for each of them would be
  // re-rendering it for nothing.
  if (loading != reported_loading_) {
    reported_loading_ = loading;
    client_->LoadingChanged(loading);
  }
}

namespace {

// The size an icon is when its link does not say: a touch icon is Apple's 180
// pixels, and anything else a tab's 16.
int AssumedSize(const blink::mojom::FaviconURL& icon) {
  return icon.icon_type == blink::mojom::FaviconIconType::kFavicon ? 16 : 180;
}

// The icon of `candidates` a launcher draws best: a drawing first, because it
// is every size at once, then the biggest. The page's first of two alike.
// The same rule the compositor's own lookup ranks a page's links by -- see
// `domicile_host::favicons`.
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
  // A CHANGE, not a notification, as every report here is: the renderer
  // reports the list again when a script touches any link in the head.
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
  // GetZoomFactor makes the same CHECK ReportHistory makes, and for the same
  // reason.
  const double zoom = GetZoomFactor();

  // ZoomValuesEqual rather than `!=`, because a factor has been through a
  // logarithm and back by the time it is read here: 1/3 set is not exactly
  // 1/3 read, and a message for the difference would be a DOM event for
  // nothing.
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
  // A find stopped, or one replaced by a search for other text: what this
  // counts is not what the element is showing.
  if (find_text_.empty() || request_id < find_session_id_) {
    return;
  }
  // -1 is content's "no change" in either field, so the last answer stands.
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
  // NOT THE WINDOW, WHICH THIS CANNOT MAKE: a guest with no SiteInstance of its
  // own is what keeps the user logged in -- see the class comment -- and
  // content CHECKs that pair in WebContentsImpl::CreateNewWindow. So the window
  // is refused, exactly as it was before this message existed, and the address
  // goes to the element. What opens a window is the shell.
  //
  // `disposition` and `window_features` are not carried, and that is the same
  // decision the class makes about everything else an embedder is asked: a
  // Domicile shell has one shape of browser window and lays it out itself, so a
  // popup's requested size is an answer to a question its desktop does not ask.
  ReportNewWindow(target_url);
  return nullptr;
}

content::WebContents* WebViewGuest::OpenURLFromTab(
    content::WebContents* source,
    const content::OpenURLParams& params,
    base::OnceCallback<void(content::NavigationHandle&)>
        navigation_handle_callback) {
  // The same CHECK the four controls make: this object is destroyed with the
  // guest's WebContents, so there is no moment at which content can call this
  // delegate and the WebContents be gone.
  CHECK(guest_contents_);

  // `guest_contents_` RATHER THAN `source`, which is the same object here and
  // says less: this delegate is set on one WebContents and only that one can
  // reach it, so naming the guest says which page is being navigated where the
  // parameter only says "whoever called".
  switch (params.disposition) {
    case WindowOpenDisposition::CURRENT_TAB: {
      // THE PAGE THE FRAME COULD NOT REACH, reached. LoadURLParams carries the
      // referrer, the transition, the POST body and the initiator origin across
      // from what the renderer asked for, which is what keeps this a
      // continuation of the navigation rather than a fresh one at the same
      // address.
      //
      // Said BEFORE the load rather than after, so the line means "the browser
      // was asked" and nothing more: whether the page then arrives is the other
      // half of the claim and is read from the page itself.
      // `guard-webview-routed-link.sh` greps for this, and it is what tells a
      // navigation this delegate routed from one Blink retargeted inside a
      // single process -- which moves the window just the same and measures
      // nothing.
      LOG(INFO) << "domicile: a <webview> followed a link its page could not "
                   "follow itself, to "
                << params.url.possibly_invalid_spec();

      base::WeakPtr<content::NavigationHandle> navigation =
          guest_contents_->GetController().LoadURLWithParams(
              content::NavigationController::LoadURLParams(params));

      // The callback is content's way of handing the caller the navigation it
      // just asked for, and a null handle is an ordinary answer rather than a
      // failure: a navigation the controller refused -- an unsupported scheme,
      // a URL a renderer may not ask for -- never starts one.
      if (navigation_handle_callback && navigation) {
        std::move(navigation_handle_callback).Run(*navigation);
      }
      return guest_contents_;
    }

    case WindowOpenDisposition::NEW_FOREGROUND_TAB:
    case WindowOpenDisposition::NEW_BACKGROUND_TAB:
    case WindowOpenDisposition::NEW_POPUP:
    case WindowOpenDisposition::NEW_WINDOW: {
      // A SECOND WINDOW, WHICH IS THE SHELL'S, and the same answer
      // CreateCustomWebContents gives -- this is the other door into it. A
      // middle click and a Ctrl click arrive here rather than there, so a
      // desktop that answered only one of the two would open a window for a
      // `target="_blank"` and do nothing for the same link middle-clicked.
      //
      // SAID HERE RATHER THAN LEFT TO ReportNewWindow, because that function is
      // shared and its line therefore cannot say WHICH door was used. The two
      // are a different fault when either breaks -- one is CreateNewWindow, the
      // other this delegate -- and a log that conflates them is a log that
      // cannot tell a working override from an override that is never called.
      // `guard-webview-routed-link.sh` greps for this line for exactly that
      // reason; the run that established the need for it read only the shared
      // line and could not tell the two apart.
      LOG(INFO) << "domicile: a <webview> routed a second-window gesture its "
                   "page could not perform itself, to "
                << params.url.possibly_invalid_spec();

      ReportNewWindow(params.url);
      return nullptr;
    }

    default: {
      // EVERYTHING ELSE IS REFUSED AND SAID OUT LOUD. Saving to disk, a
      // singleton tab, a switch to a tab that exists, an off-the-record window:
      // each is a piece of browser UI this desktop does not have, and a silent
      // return here is exactly the failure this whole override exists to undo.
      //
      // A `default` rather than an arm each, deliberately: this is a
      // //ui/base enum shared with all of Chromium, and a value added upstream
      // would turn an exhaustive switch into a build failure on a rebase for a
      // case the fork has no opinion about. The ones this desktop answers are
      // written out above; the rest are one sentence.
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
  // AN ADDRESS OR NOTHING, and the invalid case is the one to say out loud: a
  // `window.open()` with no url asks for a handle to write a document into,
  // which is precisely what a window the shell navigates to cannot be. Sending
  // it anyway would open a browser window at nothing, in answer to a script
  // that is about to write into a handle it did not get.
  if (!target_url.is_valid()) {
    LOG(WARNING) << "domicile: a <webview>'s page asked for a window with no "
                    "address to open; refused, and the shell is not told.";
    return;
  }

  client_->NewWindowRequested(target_url);

  // A warning rather than an info, because a refusal is still what happened:
  // what the user gets is a window the shell opened at this address, not the
  // window the page asked for. A run where the two differ -- an opener that was
  // needed, a POST that became a GET -- starts here.
  LOG(WARNING) << "domicile: a <webview> refused to open a window for "
               << target_url.possibly_invalid_spec()
               << "; the shell was asked to open one instead.";
}

void WebViewGuest::CloseContents(content::WebContents* source) {
  LOG(INFO) << "domicile: a <webview>'s page asked to close.";
  client_->CloseRequested();
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
  client_->ContentSizeChanged(pref_size.width(), pref_size.height());
}

void WebViewGuest::RequestFocus() {
  LOG(INFO) << "domicile: an extension asked for a <webview> in front.";
  client_->FocusRequested();
}

void WebViewGuest::RequestClose() {
  LOG(INFO) << "domicile: an extension asked to close a <webview>.";
  client_->CloseRequested();
}

void WebViewGuest::RequestWindow(const GURL& url) {
  ReportNewWindow(url);
}

void WebViewGuest::RequestPopupWindow(int window_id,
                                      const GURL& url,
                                      int width,
                                      int height) {
  // What guard-extension-popup-window.sh reads to tell "the shell was never
  // asked" from "the shell was asked and opened nothing".
  LOG(INFO) << "domicile: an extension asked for popup window " << window_id
            << "; the shell was asked to open it.";
  client_->PopupWindowRequested(window_id, url, width, height);
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
  // Owns itself and goes with the document. `new` with no matching delete is
  // what DocumentService is.
  new WebViewGuestHost(*frame, std::move(receiver), std::move(created));
}

}  // namespace domicile
